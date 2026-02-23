"""Detection module: background subtraction, contour detection, centroid tracking, best frame selection."""

from __future__ import annotations

import logging

import cv2
import numpy as np

from config import ScannerConfig
from models import Contour

logger = logging.getLogger(__name__)


class PieceDetector:
    """MOG2 background subtraction + contour detection."""

    def __init__(self, config: ScannerConfig):
        self.bg_subtractor = cv2.createBackgroundSubtractorMOG2(
            history=config.calibration_frames,
            varThreshold=16,
            detectShadows=True,
        )
        self.roi: tuple[int, int, int, int] | None = None  # x, y, w, h
        self.min_area = config.min_contour_area
        self.max_area = config.max_contour_area
        self._kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))

    def train_background(self, frames: list[np.ndarray]) -> None:
        """Feed background frames to MOG2 model."""
        for frame in frames:
            self.bg_subtractor.apply(frame, learningRate=0.05)
        logger.info(f"Background model trained on {len(frames)} frames")

    def detect(self, frame: np.ndarray) -> list[Contour]:
        """Apply subtractor, filter contours by area and ROI."""
        fg_mask = self.bg_subtractor.apply(frame, learningRate=0.001)

        # Remove shadows (value 127 in MOG2)
        _, fg_mask = cv2.threshold(fg_mask, 200, 255, cv2.THRESH_BINARY)

        # Morphological operations to clean noise
        fg_mask = cv2.erode(fg_mask, self._kernel, iterations=1)
        fg_mask = cv2.dilate(fg_mask, self._kernel, iterations=2)

        contours_raw, _ = cv2.findContours(
            fg_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE
        )

        results = []
        for cnt in contours_raw:
            area = cv2.contourArea(cnt)
            if area < self.min_area or area > self.max_area:
                continue

            M = cv2.moments(cnt)
            if M["m00"] == 0:
                continue

            cx = M["m10"] / M["m00"]
            cy = M["m01"] / M["m00"]

            # Check if centroid is within ROI
            if self.roi is not None:
                rx, ry, rw, rh = self.roi
                if not (rx <= cx <= rx + rw and ry <= cy <= ry + rh):
                    continue

            x, y, w, h = cv2.boundingRect(cnt)
            results.append(
                Contour(
                    contour=cnt,
                    area=area,
                    centroid=(cx, cy),
                    bounding_rect=(x, y, w, h),
                )
            )

        return results


class CentroidTracker:
    """Tracks objects across frames via centroid matching."""

    def __init__(self, max_disappeared: int = 10):
        self.next_id: int = 0
        self.objects: dict[int, tuple[float, float]] = {}
        self.disappeared: dict[int, int] = {}
        self.max_disappeared = max_disappeared

    def _register(self, centroid: tuple[float, float]) -> int:
        object_id = self.next_id
        self.objects[object_id] = centroid
        self.disappeared[object_id] = 0
        self.next_id += 1
        return object_id

    def _deregister(self, object_id: int) -> None:
        del self.objects[object_id]
        del self.disappeared[object_id]

    def update(self, contours: list[Contour]) -> dict[int, tuple[float, float]]:
        """Match new contours to existing objects by nearest centroid."""
        if len(contours) == 0:
            for oid in list(self.disappeared.keys()):
                self.disappeared[oid] += 1
                if self.disappeared[oid] > self.max_disappeared:
                    self._deregister(oid)
            return dict(self.objects)

        input_centroids = [c.centroid for c in contours]

        if len(self.objects) == 0:
            for centroid in input_centroids:
                self._register(centroid)
            return dict(self.objects)

        object_ids = list(self.objects.keys())
        object_centroids = list(self.objects.values())

        # Compute distance matrix
        dists = np.zeros((len(object_centroids), len(input_centroids)))
        for i, oc in enumerate(object_centroids):
            for j, ic in enumerate(input_centroids):
                dists[i, j] = np.sqrt((oc[0] - ic[0]) ** 2 + (oc[1] - ic[1]) ** 2)

        # Greedy matching: smallest distances first
        rows = dists.min(axis=1).argsort()
        cols = dists.argmin(axis=1)[rows]

        used_rows: set[int] = set()
        used_cols: set[int] = set()

        for row, col in zip(rows, cols):
            if row in used_rows or col in used_cols:
                continue
            if dists[row, col] > 100:
                continue

            object_id = object_ids[row]
            self.objects[object_id] = input_centroids[col]
            self.disappeared[object_id] = 0
            used_rows.add(row)
            used_cols.add(col)

        # Handle unmatched existing objects
        for row in range(len(object_centroids)):
            if row not in used_rows:
                oid = object_ids[row]
                self.disappeared[oid] += 1
                if self.disappeared[oid] > self.max_disappeared:
                    self._deregister(oid)

        # Handle unmatched new contours
        for col in range(len(input_centroids)):
            if col not in used_cols:
                self._register(input_centroids[col])

        return dict(self.objects)

    def reset(self) -> None:
        self.next_id = 0
        self.objects.clear()
        self.disappeared.clear()


class BestFrameSelector:
    """Picks the sharpest, most centred frame per tracked piece."""

    def __init__(self):
        self.piece_frames: dict[int, list[tuple[np.ndarray, float, float]]] = {}

    def add_frame(
        self,
        track_id: int,
        frame: np.ndarray,
        centroid: tuple[float, float],
        roi: tuple[int, int, int, int] | None,
    ) -> None:
        """Score frame and store."""
        if track_id not in self.piece_frames:
            self.piece_frames[track_id] = []

        sharpness = self._laplacian_variance(frame)
        centredness = self._centredness_weight(centroid, roi) if roi else 1.0
        score = sharpness * centredness

        self.piece_frames[track_id].append((frame.copy(), score, sharpness))

    def get_best_frame(self, track_id: int) -> tuple[np.ndarray, float] | None:
        """Return highest-scoring frame and its sharpness."""
        if track_id not in self.piece_frames or not self.piece_frames[track_id]:
            return None

        best = max(self.piece_frames[track_id], key=lambda x: x[1])
        return best[0], best[2]

    def remove(self, track_id: int) -> None:
        """Clean up after piece submitted."""
        self.piece_frames.pop(track_id, None)

    @staticmethod
    def _laplacian_variance(frame: np.ndarray) -> float:
        """Compute Laplacian variance as sharpness metric."""
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY) if len(frame.shape) == 3 else frame
        lap = cv2.Laplacian(gray, cv2.CV_64F)
        return float(lap.var())

    @staticmethod
    def _centredness_weight(
        centroid: tuple[float, float],
        roi: tuple[int, int, int, int],
    ) -> float:
        """Weight based on distance from ROI centre. 1.0 = centre, 0.5 = edge."""
        rx, ry, rw, rh = roi
        centre_x = rx + rw / 2
        centre_y = ry + rh / 2
        half_diag = np.sqrt((rw / 2) ** 2 + (rh / 2) ** 2)

        if half_diag == 0:
            return 1.0

        dist = np.sqrt((centroid[0] - centre_x) ** 2 + (centroid[1] - centre_y) ** 2)
        return max(0.5, 1.0 - (dist / half_diag) * 0.5)
