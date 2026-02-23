"""Camera module: captures frames from IP Webcam phone app."""

from __future__ import annotations

import asyncio
import logging

import aiohttp
import cv2
import numpy as np

from config import ScannerConfig

logger = logging.getLogger(__name__)


class CameraClient:
    """Polls IP Webcam /shot.jpg endpoint for frames."""

    def __init__(self, config: ScannerConfig):
        self.base_url = f"http://{config.phone_ip}:{config.phone_port}"
        self.shot_url = f"{self.base_url}/shot.jpg"
        self.fps = config.camera_fps
        self._session: aiohttp.ClientSession | None = None
        self._max_retries = 5
        self._retry_delays = [1, 2, 4, 8, 16]  # exponential backoff

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
