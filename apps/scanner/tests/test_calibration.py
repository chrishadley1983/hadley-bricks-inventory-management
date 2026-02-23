"""Tests for the calibration module (F12, E2)."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import numpy as np
import pytest

from calibration import CalibrationFlow
from config import ScannerConfig
from models import CalibrationResult


@pytest.fixture
def calibration(config: ScannerConfig, mock_camera) -> CalibrationFlow:
    return CalibrationFlow(camera=mock_camera, config=config)


class TestCalibrationRun:
    """F12: Full calibration sequence."""

    @pytest.mark.asyncio
    async def test_run_returns_calibration_result(self, calibration: CalibrationFlow):
        """Calibration returns a CalibrationResult with all fields."""
        with patch.object(calibration, "_select_roi", return_value=(0, 0, 640, 480)):
            result = await calibration.run()

        assert isinstance(result, CalibrationResult)
        assert len(result.background_frames) > 0
        assert result.lighting_ok is True
        assert result.roi is not None

    @pytest.mark.asyncio
    async def test_run_with_camera_failures(
        self, config: ScannerConfig, mock_camera
    ):
        """Calibration handles partial frame capture."""
        # Return None for some frames
        mock_camera.capture_frame_with_retry = AsyncMock(
            side_effect=[
                np.full((480, 640, 3), 128, dtype=np.uint8),
                None,
                np.full((480, 640, 3), 128, dtype=np.uint8),
                None,
                np.full((480, 640, 3), 128, dtype=np.uint8),
            ]
        )
        cal = CalibrationFlow(camera=mock_camera, config=config)

        with patch.object(cal, "_select_roi", return_value=(0, 0, 640, 480)):
            result = await cal.run()

        assert len(result.background_frames) == 3  # Only non-None frames


class TestLightingCheck:
    """F12/E2: Lighting quality assessment."""

    def test_good_lighting(self, sample_frame: np.ndarray):
        """Normal brightness passes lighting check."""
        result = CalibrationFlow._check_lighting([sample_frame])
        assert result["ok"] is True

    def test_too_dark(self, dark_frame: np.ndarray):
        """Very dark frame fails lighting check."""
        result = CalibrationFlow._check_lighting([dark_frame])
        assert result["ok"] is False
        assert "too dark" in result["warning"].lower()

    def test_uneven_lighting(self):
        """High brightness variance fails lighting check."""
        bright = np.full((480, 640, 3), 200, dtype=np.uint8)
        dim = np.full((480, 640, 3), 40, dtype=np.uint8)
        result = CalibrationFlow._check_lighting([bright, dim])
        assert result["ok"] is False
        assert "uneven" in result["warning"].lower()

    def test_no_frames(self):
        """Empty frame list fails gracefully."""
        result = CalibrationFlow._check_lighting([])
        assert result["ok"] is False
        assert "no frames" in result["warning"].lower()


class TestContrastCheck:
    """E2: Black piece detection warning."""

    def test_good_contrast(self, white_frame: np.ndarray):
        """Bright surface passes contrast check."""
        result = CalibrationFlow._check_contrast([white_frame])
        assert result["ok"] is True

    def test_dark_surface_warning(self, dark_frame: np.ndarray):
        """Dark surface triggers black piece warning."""
        result = CalibrationFlow._check_contrast([dark_frame])
        assert result["ok"] is False
        assert "dark" in result["warning"].lower()
        assert "black" in result["warning"].lower() or "piece" in result["warning"].lower()

    def test_no_frames(self):
        """Empty frames returns ok (no crash)."""
        result = CalibrationFlow._check_contrast([])
        assert result["ok"] is True


class TestROISelection:
    """F12: ROI selection."""

    def test_select_roi_with_selection(self, sample_frame: np.ndarray):
        """Valid ROI selection returns coordinates."""
        with patch("cv2.selectROI", return_value=(100, 50, 400, 300)):
            with patch("cv2.destroyAllWindows"):
                roi = CalibrationFlow._select_roi(sample_frame)

        assert roi == (100, 50, 400, 300)

    def test_select_roi_cancelled(self, sample_frame: np.ndarray):
        """Cancelled selection (0,0,0,0) falls back to full frame."""
        with patch("cv2.selectROI", return_value=(0, 0, 0, 0)):
            with patch("cv2.destroyAllWindows"):
                roi = CalibrationFlow._select_roi(sample_frame)

        assert roi == (0, 0, 640, 480)  # Full frame
