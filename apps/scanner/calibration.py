"""Calibration module: background capture, ROI selection, lighting check."""

from __future__ import annotations

import logging

import cv2
import numpy as np

from camera import CameraClient
from config import ScannerConfig
from models import CalibrationResult

logger = logging.getLogger(__name__)

# Lighting thresholds
MIN_BRIGHTNESS = 30  # Mean brightness below this = too dark
MAX_BRIGHTNESS_STD = 50  # Std dev above this = uneven lighting
LOW_CONTRAST_THRESHOLD = 40  # Mean brightness below this triggers black piece warning


class CalibrationFlow:
    """Interactive calibration at session start."""

    def __init__(self, camera: CameraClient, config: ScannerConfig):
        self.camera = camera
        self.n_frames = config.calibration_frames

    async def run(self) -> CalibrationResult:
        """Full calibration sequence."""
        result = CalibrationResult()

        # Step 1: Capture background frames
        logger.info(f"Capturing {self.n_frames} background frames...")
        frames = await self._capture_background_frames()
        result.background_frames = frames

        if len(frames) < self.n_frames:
            logger.warning(
                f"Only captured {len(frames)}/{self.n_frames} background frames"
            )

        # Step 2: Check lighting
        lighting = self._check_lighting(frames)
        result.lighting_ok = lighting["ok"]
        result.lighting_warning = lighting.get("warning")

        # Step 3: Check contrast (black piece warning)
        contrast = self._check_contrast(frames)
        result.contrast_ok = contrast["ok"]
        result.contrast_warning = contrast.get("warning")

        # Step 4: ROI selection (OpenCV window)
        if frames:
            roi = self._select_roi(frames[-1])
            result.roi = roi

        return result

    async def _capture_background_frames(self) -> list[np.ndarray]:
        """Capture N background frames from camera."""
        frames = []
        for i in range(self.n_frames):
            frame = await self.camera.capture_frame_with_retry()
            if frame is not None:
                frames.append(frame)
        return frames

    @staticmethod
    def _check_lighting(frames: list[np.ndarray]) -> dict:
        """Check lighting quality across frames."""
        if not frames:
            return {"ok": False, "warning": "No frames captured for lighting check"}

        brightness_values = []
        for frame in frames:
            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            brightness_values.append(float(np.mean(gray)))

        mean_brightness = np.mean(brightness_values)
        std_brightness = np.std(brightness_values)

        if mean_brightness < MIN_BRIGHTNESS:
            return {
                "ok": False,
                "warning": (
                    f"Scene too dark (mean brightness: {mean_brightness:.0f}). "
                    "Add more lighting or move desk lamp closer."
                ),
            }

        if std_brightness > MAX_BRIGHTNESS_STD:
            return {
                "ok": False,
                "warning": (
                    f"Uneven lighting detected (brightness std: {std_brightness:.1f}). "
                    "Ensure consistent illumination across the belt."
                ),
            }

        return {"ok": True}

    @staticmethod
    def _check_contrast(frames: list[np.ndarray]) -> dict:
        """Check if belt is dark (black piece detection issue)."""
        if not frames:
            return {"ok": True}

        # Check brightness of the belt surface
        gray = cv2.cvtColor(frames[-1], cv2.COLOR_BGR2GRAY)
        mean_val = float(np.mean(gray))

        if mean_val < LOW_CONTRAST_THRESHOLD:
            return {
                "ok": False,
                "warning": (
                    f"Dark belt surface detected (brightness: {mean_val:.0f}). "
                    "Dark/black LEGO pieces may be hard to detect. "
                    "Consider placing a strip of white or green paper/felt on the belt."
                ),
            }

        return {"ok": True}

    @staticmethod
    def _select_roi(frame: np.ndarray) -> tuple[int, int, int, int]:
        """Open OpenCV window for ROI rectangle selection."""
        roi = cv2.selectROI(
            "Select Identification Zone - Press ENTER to confirm, C to cancel",
            frame,
            fromCenter=False,
            showCrosshair=True,
        )
        cv2.destroyAllWindows()

        x, y, w, h = int(roi[0]), int(roi[1]), int(roi[2]), int(roi[3])

        if w == 0 or h == 0:
            # No ROI selected, use full frame
            h_frame, w_frame = frame.shape[:2]
            logger.warning("No ROI selected, using full frame")
            return (0, 0, w_frame, h_frame)

        logger.info(f"ROI selected: x={x}, y={y}, w={w}, h={h}")
        return (x, y, w, h)
