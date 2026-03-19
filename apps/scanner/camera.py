"""Camera module: captures frames from IP Webcam phone app."""

from __future__ import annotations

import asyncio
import dataclasses
import logging
import os

import aiohttp
import cv2
import numpy as np

from config import ScannerConfig

logger = logging.getLogger(__name__)

# Known-good IP tried first to avoid a full subnet scan when possible.
# Override with PHONE_IP_HINT env var if the phone gets a new DHCP lease.
_KNOWN_IP = os.environ.get("PHONE_IP_HINT", "192.168.0.59")
_SCAN_SUBNETS = ["192.168.0", "192.168.1"]
_SCAN_CONCURRENCY = 50  # parallel HEAD requests
_SCAN_TIMEOUT = 0.5  # seconds per probe


async def _probe_ip(session: aiohttp.ClientSession, ip: str, port: int) -> bool:
    """Return True if IP Webcam is responding at http://{ip}:{port}/shot.jpg."""
    url = f"http://{ip}:{port}/shot.jpg"
    try:
        async with session.head(url) as resp:
            return resp.status == 200
    except Exception:
        return False


async def discover_phone_ip(port: int = 8080) -> str:
    """Scan the local network for an IP Webcam instance and return its IP.

    Strategy:
    1. Try the known IP (192.168.0.59) first — instant if on the same network.
    2. Scan 192.168.0.x and 192.168.1.x concurrently with a semaphore.

    Returns the discovered IP string.
    Raises RuntimeError if no camera is found.
    """
    timeout = aiohttp.ClientTimeout(total=_SCAN_TIMEOUT)
    connector = aiohttp.TCPConnector(limit=0)

    async with aiohttp.ClientSession(timeout=timeout, connector=connector) as session:
        # Step 1: fast-path — try the known IP first
        logger.info("Auto-discovery: checking known IP %s:%d …", _KNOWN_IP, port)
        if await _probe_ip(session, _KNOWN_IP, port):
            logger.info("Auto-discovery: found camera at known IP %s", _KNOWN_IP)
            return _KNOWN_IP

        # Step 2: full subnet scan with bounded concurrency
        semaphore = asyncio.Semaphore(_SCAN_CONCURRENCY)

        async def probe_with_sem(ip: str) -> str | None:
            async with semaphore:
                return ip if await _probe_ip(session, ip, port) else None

        candidates: list[str] = [
            f"{subnet}.{host}"
            for subnet in _SCAN_SUBNETS
            for host in range(1, 255)
            if f"{subnet}.{host}" != _KNOWN_IP  # already tried above
        ]

        logger.info(
            "Auto-discovery: scanning %d IPs across %s …",
            len(candidates),
            ", ".join(f"{s}.x" for s in _SCAN_SUBNETS),
        )

        tasks = [asyncio.create_task(probe_with_sem(ip)) for ip in candidates]
        found: str | None = None
        for coro in asyncio.as_completed(tasks):
            result = await coro
            if result is not None:
                found = result
                # Cancel remaining tasks — first match wins
                for t in tasks:
                    t.cancel()
                await asyncio.gather(*tasks, return_exceptions=True)
                break

        if found:
            logger.info("Auto-discovery: found camera at %s", found)
            return found

    raise RuntimeError(
        f"Auto-discovery failed: no IP Webcam found on port {port} in subnets "
        + ", ".join(f"{s}.x" for s in _SCAN_SUBNETS)
        + ". Set PHONE_IP explicitly or start the IP Webcam app."
    )


class CameraClient:
    """Polls IP Webcam /shot.jpg endpoint for frames."""

    def __init__(self, config: ScannerConfig):
        # NOTE: when phone_ip is "auto", call CameraClient.create(config) instead
        # of constructing directly so that discovery can run asynchronously.
        self.base_url = f"http://{config.phone_ip}:{config.phone_port}"
        self.shot_url = f"{self.base_url}/shot.jpg"
        self.fps = config.camera_fps
        self._session: aiohttp.ClientSession | None = None
        self._max_retries = 5
        self._retry_delays = [1, 2, 4, 8, 16]  # exponential backoff

    @classmethod
    async def create(cls, config: ScannerConfig) -> "CameraClient":
        """Factory that resolves 'auto' IP before constructing the client."""
        if config.phone_ip == "auto":
            resolved_ip = await discover_phone_ip(config.phone_port)
            config = dataclasses.replace(config, phone_ip=resolved_ip)
        return cls(config)

    async def _get_session(self) -> aiohttp.ClientSession:
        if self._session is None or self._session.closed:
            timeout = aiohttp.ClientTimeout(total=5)
            self._session = aiohttp.ClientSession(timeout=timeout)
        return self._session

    async def health_check(self) -> bool:
        """Ping camera, return True if reachable."""
        try:
            session = await self._get_session()
            async with session.get(self.shot_url) as resp:
                if resp.status == 200:
                    data = await resp.read()
                    return len(data) > 0
                return False
        except (aiohttp.ClientError, asyncio.TimeoutError):
            return False

    async def capture_frame(self) -> np.ndarray:
        """GET /shot.jpg, decode JPEG, return BGR numpy array."""
        session = await self._get_session()
        async with session.get(self.shot_url) as resp:
            if resp.status != 200:
                raise ConnectionError(f"Camera returned status {resp.status}")
            data = await resp.read()

        arr = np.frombuffer(data, np.uint8)
        frame = cv2.imdecode(arr, cv2.IMREAD_COLOR)
        if frame is None:
            raise ValueError("Failed to decode JPEG frame")
        return frame

    async def capture_frame_with_retry(self) -> np.ndarray | None:
        """Capture a frame with exponential backoff on failure."""
        for attempt in range(self._max_retries):
            try:
                return await self.capture_frame()
            except (aiohttp.ClientError, asyncio.TimeoutError, ConnectionError, ValueError) as e:
                delay = self._retry_delays[min(attempt, len(self._retry_delays) - 1)]
                logger.warning(f"Frame capture failed (attempt {attempt + 1}): {e}. Retrying in {delay}s")
                await asyncio.sleep(delay)
        logger.error(f"Frame capture failed after {self._max_retries} attempts")
        return None

    async def stream_frames(self, queue: asyncio.Queue, stop_event: asyncio.Event) -> None:
        """Continuous polling loop. Puts frames into queue at configured FPS."""
        interval = 1.0 / self.fps
        consecutive_failures = 0
        max_consecutive_failures = 5

        while not stop_event.is_set():
            frame = await self.capture_frame_with_retry()
            if frame is not None:
                consecutive_failures = 0
                try:
                    queue.put_nowait(frame)
                except asyncio.QueueFull:
                    # Drop oldest frame to make room
                    try:
                        queue.get_nowait()
                    except asyncio.QueueEmpty:
                        pass
                    queue.put_nowait(frame)
            else:
                consecutive_failures += 1
                if consecutive_failures >= max_consecutive_failures:
                    logger.error("Camera disconnected: too many consecutive failures")
                    break

            await asyncio.sleep(interval)

    async def close(self) -> None:
        """Close the HTTP session."""
        if self._session and not self._session.closed:
            await self._session.close()
