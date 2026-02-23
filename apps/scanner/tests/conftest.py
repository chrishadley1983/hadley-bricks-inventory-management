"""Shared fixtures for scanner tests."""

from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import numpy as np
import pytest

# Add scanner root to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from config import ScannerConfig
from models import (
    BrickognizeItem,
    BrickognizeResponse,
    CalibrationResult,
    Contour,
    IdentificationResult,
)


@pytest.fixture
def config() -> ScannerConfig:
    """Default test config matching ScannerConfig defaults where sensible."""
    return ScannerConfig(
        phone_ip="192.168.1.100",
        phone_port=8080,
        camera_fps=3,
        confidence_threshold=0.70,
        min_contour_area=500,
        max_contour_area=50000,
        brickognize_max_rps=2,
        brickognize_top_n=5,
        calibration_frames=5,
        image_retention_days=90,
        supabase_url="https://test.supabase.co",
        supabase_key="test-key",
        user_id="test-user-id",
    )


@pytest.fixture
def sample_frame() -> np.ndarray:
    """A 480x640 BGR test frame (gray background)."""
    return np.full((480, 640, 3), 128, dtype=np.uint8)


@pytest.fixture
def white_frame() -> np.ndarray:
    """A 480x640 white BGR frame."""
    return np.full((480, 640, 3), 255, dtype=np.uint8)


@pytest.fixture
def dark_frame() -> np.ndarray:
    """A 480x640 very dark BGR frame."""
    return np.full((480, 640, 3), 10, dtype=np.uint8)


@pytest.fixture
def frame_with_blob() -> np.ndarray:
    """A frame with a white rectangle on gray background (simulates a piece)."""
    frame = np.full((480, 640, 3), 50, dtype=np.uint8)
    frame[150:210, 200:280] = 255
    return frame


@pytest.fixture
def sample_contour() -> Contour:
    """A sample Contour object."""
    pts = np.array([[200, 150], [280, 150], [280, 210], [200, 210]], dtype=np.int32)
    return Contour(
        contour=pts,
        area=4800.0,
        centroid=(240.0, 180.0),
        bounding_rect=(200, 150, 80, 60),
    )


@pytest.fixture
def sample_brickognize_item() -> BrickognizeItem:
    """A sample Brickognize API result item."""
    return BrickognizeItem(
        id="3001",
        name="Brick 2 x 4",
        score=0.92,
        img_url="https://img.bricklink.com/3001.png",
        category="Brick",
        type="part",
    )


@pytest.fixture
def sample_brickognize_response(sample_brickognize_item: BrickognizeItem) -> BrickognizeResponse:
    """A sample parsed Brickognize response."""
    return BrickognizeResponse(
        listing_id="abc-123",
        bounding_box={"x": 10, "y": 20, "w": 100, "h": 80},
        items=[
            sample_brickognize_item,
            BrickognizeItem(id="3002", name="Brick 2 x 3", score=0.65, category="Brick"),
        ],
    )


@pytest.fixture
def sample_identification_result(sample_brickognize_item: BrickognizeItem) -> IdentificationResult:
    """A sample identification result."""
    return IdentificationResult(
        track_id=1,
        brickognize_item_id="3001",
        brickognize_listing_id="abc-123",
        item_name="Brick 2 x 4",
        item_category="Brick",
        confidence=0.92,
        status="accepted",
        top_results=[sample_brickognize_item],
        image_bytes=b"\xff\xd8\xff\xe0fake-jpeg",
        frame_sharpness=150.0,
    )


@pytest.fixture
def jpeg_bytes() -> bytes:
    """Minimal valid JPEG bytes for testing."""
    import cv2

    img = np.full((32, 32, 3), 128, dtype=np.uint8)
    _, buf = cv2.imencode(".jpg", img)
    return buf.tobytes()


@pytest.fixture
def mock_camera() -> MagicMock:
    """Mock CameraClient."""
    camera = MagicMock()
    camera.health_check = AsyncMock(return_value=True)
    camera.capture_frame = AsyncMock(
        return_value=np.full((480, 640, 3), 128, dtype=np.uint8)
    )
    camera.capture_frame_with_retry = AsyncMock(
        return_value=np.full((480, 640, 3), 128, dtype=np.uint8)
    )
    camera.close = AsyncMock()
    return camera
