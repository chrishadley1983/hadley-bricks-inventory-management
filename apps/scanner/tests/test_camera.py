"""Tests for the camera module (F2, E1-camera)."""

from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import aiohttp
import numpy as np
import pytest

from camera import CameraClient
from config import ScannerConfig


@pytest.fixture
def camera(config: ScannerConfig) -> CameraClient:
    return CameraClient(config)


def _make_mock_session(responses):
    """Create a mock aiohttp session returning the given responses in order."""
    session = MagicMock(spec=aiohttp.ClientSession)
    session.closed = False

    if callable(responses):
        session.get = MagicMock(side_effect=responses)
    else:
        session.get = MagicMock(side_effect=responses)

    return session


def _ok_response(data: bytes):
    """Create a mock 200 response that returns data."""
    resp = AsyncMock()
    resp.status = 200
    resp.read = AsyncMock(return_value=data)
    ctx = MagicMock()
    ctx.__aenter__ = AsyncMock(return_value=resp)
    ctx.__aexit__ = AsyncMock(return_value=False)
    return ctx


def _error_response(status: int = 500):
    """Create a mock error response."""
    resp = AsyncMock()
    resp.status = status
    ctx = MagicMock()
    ctx.__aenter__ = AsyncMock(return_value=resp)
    ctx.__aexit__ = AsyncMock(return_value=False)
    return ctx


def _exception_response(exc):
    """Create a context manager that raises on __aenter__."""
    ctx = MagicMock()
    ctx.__aenter__ = AsyncMock(side_effect=exc)
    ctx.__aexit__ = AsyncMock(return_value=False)
    return ctx


class TestHealthCheck:
    """F2: Camera connects to IP Webcam and captures frames."""

    @pytest.mark.asyncio
    async def test_health_check_success(self, camera: CameraClient, jpeg_bytes: bytes):
        """Health check returns True when camera responds 200 with data."""
        session = _make_mock_session([_ok_response(jpeg_bytes)])
        camera._session = session

        with patch.object(camera, "_get_session", return_value=session):
            result = await camera.health_check()
        assert result is True

    @pytest.mark.asyncio
    async def test_health_check_failure(self, camera: CameraClient):
        """Health check returns False on connection error."""
        session = _make_mock_session([_exception_response(aiohttp.ClientError())])
        with patch.object(camera, "_get_session", return_value=session):
            result = await camera.health_check()
        assert result is False


class TestCaptureFrame:
    """F2: Frame capture and decode."""

    @pytest.mark.asyncio
    async def test_capture_returns_bgr_array(self, camera: CameraClient, jpeg_bytes: bytes):
        """Captured frame is a 3-channel numpy array."""
        session = _make_mock_session([_ok_response(jpeg_bytes)])
        with patch.object(camera, "_get_session", return_value=session):
            frame = await camera.capture_frame()
        assert frame is not None
        assert isinstance(frame, np.ndarray)
        assert len(frame.shape) == 3
        assert frame.shape[2] == 3  # BGR

    @pytest.mark.asyncio
    async def test_capture_raises_on_error(self, camera: CameraClient):
        """Raises ConnectionError when camera request fails."""
        session = _make_mock_session([_exception_response(aiohttp.ClientError("timeout"))])
        with patch.object(camera, "_get_session", return_value=session):
            with pytest.raises((aiohttp.ClientError, ConnectionError)):
                await camera.capture_frame()

    @pytest.mark.asyncio
    async def test_capture_raises_on_bad_status(self, camera: CameraClient):
        """Raises ConnectionError on non-200 response."""
        session = _make_mock_session([_error_response(500)])
        with patch.object(camera, "_get_session", return_value=session):
            with pytest.raises(ConnectionError):
                await camera.capture_frame()


class TestCaptureWithRetry:
    """E1-camera: Retry with exponential backoff."""

    @pytest.mark.asyncio
    async def test_retry_succeeds_after_failures(self, camera: CameraClient, jpeg_bytes: bytes):
        """Retries and returns frame on eventual success."""
        responses = [
            _exception_response(aiohttp.ClientError("fail")),
            _exception_response(aiohttp.ClientError("fail")),
            _ok_response(jpeg_bytes),
        ]
        session = _make_mock_session(responses)

        with patch.object(camera, "_get_session", return_value=session):
            with patch("asyncio.sleep", new_callable=AsyncMock):
                frame = await camera.capture_frame_with_retry()

        assert frame is not None
        assert isinstance(frame, np.ndarray)

    @pytest.mark.asyncio
    async def test_retry_returns_none_after_max_retries(self, camera: CameraClient):
        """Returns None after exhausting all retries."""
        def always_fail():
            return _exception_response(aiohttp.ClientError("network down"))

        session = _make_mock_session([always_fail() for _ in range(10)])

        with patch.object(camera, "_get_session", return_value=session):
            with patch("asyncio.sleep", new_callable=AsyncMock):
                frame = await camera.capture_frame_with_retry()

        assert frame is None


class TestStreamFrames:
    """F2: Continuous frame streaming to queue."""

    @pytest.mark.asyncio
    async def test_stream_puts_frames_on_queue(self, camera: CameraClient, jpeg_bytes: bytes):
        """Stream loop puts captured frames onto the queue."""
        queue: asyncio.Queue = asyncio.Queue(maxsize=5)
        stop_event = asyncio.Event()

        # Mock capture_frame_with_retry to return a frame then stop
        call_count = 0
        frame = np.full((480, 640, 3), 128, dtype=np.uint8)

        async def mock_capture():
            nonlocal call_count
            call_count += 1
            if call_count > 2:
                stop_event.set()
            return frame

        camera.capture_frame_with_retry = mock_capture

        with patch("asyncio.sleep", new_callable=AsyncMock):
            await camera.stream_frames(queue, stop_event)

        assert not queue.empty()
        result = await queue.get()
        assert isinstance(result, np.ndarray)
