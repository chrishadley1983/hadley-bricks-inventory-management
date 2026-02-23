"""Detection module: background subtraction, contour detection, centroid tracking, best frame selection."""

from __future__ import annotations

import logging

import cv2
import numpy as np

from config import ScannerConfig
from models import Contour

logger = logging.getLogger(__name__)


class PieceDetector:
    """Static background subtraction + contour detection."""

    EDGE_MARGIN = 80  # pixels - filter contours touching frame edges
    MERGE_DISTANCE = 60  # pixels - merge contours whose bounding boxes are within this distance

    def __init__(self, config: ScannerConfig):
        self.roi: tuple[int, int, int, int] | None = None  # x, y, w, h
        self.min_area = config.min_contour_area
        self.max_area = config.max_contour_area
        self._kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
        self._bg_threshold = config.bg_subtract_threshold
        self._bg_gray: np.ndarray | None = None

    def train_background(self, frames: list[np.ndarray]) -> None:
        """Build static background model from averaged frames."""
        bg_avg = np.mean(frames, axis=0).astype(np.uint8)
        self._bg_gray = cv2.cvtColor(bg_avg, cv2.COLOR_BGR2GRAY)
        logger.info(f"Background model trained on {len(frames)} frames (static, thresh={self._bg_threshold})")

    def detect(self, frame: np.ndarray) -> list[Contour]:
        """Apply static background subtraction, filter contours by area, ROI, and edge margin.

        Uses two-pass detection to handle both opaque and transparent pieces:
        1. Pre-erosion pass catches transparent/sparse contours that erosion would destroy
        2. Post-erosion pass catches opaque pieces with noise removed
        Results are merged with deduplication.
        """
        if self._bg_gray is None:
            return []

        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        diff = cv2.absdiff(gray, self._bg_gray)
        _, fg_mask_raw = cv2.threshold(diff, self._bg_threshold, 255, cv2.THRESH_BINARY)

        # Pass 1: Pre-erosion contours (catches transparent pieces)
        contours_pre, _ = cv2.findContours(
            fg_mask_raw, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE
        )

        # Pass 2: Post-erosion contours (standard opaque detection)
        fg_mask_eroded = cv2.erode(fg_mask_raw, self._kernel, iterations=1)
        contours_post, _ = cv2.findContours(
            fg_mask_eroded, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE
        )

        frame_h, frame_w = frame.shape[:2]
        margin = self.EDGE_MARGIN

        # Collect candidates from post-erosion (standard, low-noise)
        candidates: list[tuple[np.ndarray, tuple[int, int, int, int]]] = []
        post_bboxes: list[tuple[int, int, int, int]] = []
        for cnt in contours_post:
            area = cv2.contourArea(cnt)
            if area < self.min_area or area > self.max_area:
                continue

            x, y, w, h = cv2.boundingRect(cnt)

            if x < margin or y < margin:
                continue
            if x + w > frame_w - margin or y + h > frame_h - margin:
                continue

            candidates.append((cnt, (x, y, w, h)))
            post_bboxes.append((x, y, w, h))

        # Add pre-erosion contours that were NOT already found post-erosion
        # These are transparent/sparse pieces that erosion destroyed
        for cnt in contours_pre:
            area = cv2.contourArea(cnt)
            if area < self.min_area or area > self.max_area:
                continue

            x, y, w, h = cv2.boundingRect(cnt)

            if x < margin or y < margin:
                continue
            if x + w > frame_w - margin or y + h > frame_h - margin:
                continue

            # Skip if this overlaps with an already-found post-erosion contour
            if self._overlaps_any(x, y, w, h, post_bboxes):
                continue

            candidates.append((cnt, (x, y, w, h)))

        # Merge nearby contours (handles fragmented pieces like minifigures)
        merged = self._merge_nearby_contours(candidates)

        results = []
        for cnt, bbox in merged:
            area = cv2.contourArea(cnt)

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

            # Re-check max area after merge (merged piece might exceed limit)
            if area > self.max_area:
                continue

            results.append(
                Contour(
                    contour=cnt,
                    area=area,
                    centroid=(cx, cy),
                    bounding_rect=bbox,
                )
            )

        return results

    @staticmethod
    def _overlaps_any(
        x: int, y: int, w: int, h: int,
        bboxes: list[tuple[int, int, int, int]],
    ) -> bool:
        """Check if bbox overlaps with any bbox in the list."""
        for bx, by, bw, bh in bboxes:
            # Check for intersection
            if x < bx + bw and x + w > bx and y < by + bh and y + h > by:
                return True
        return False

    def _merge_nearby_contours(
        self,
        candidates: list[tuple[np.ndarray, tuple[int, int, int, int]]],
    ) -> list[tuple[np.ndarray, tuple[int, int, int, int]]]:
        """Merge contours whose bounding boxes are within MERGE_DISTANCE pixels."""
        if len(candidates) <= 1:
            return candidates

        # Union-Find to group nearby contours
        n = len(candidates)
        parent = list(range(n))

        def find(i: int) -> int:
            while parent[i] != i:
                parent[i] = parent[parent[i]]
                i = parent[i]
            return i

        def union(i: int, j: int) -> None:
            pi, pj = find(i), find(j)
            if pi != pj:
                parent[pi] = pj

        dist = self.MERGE_DISTANCE
        for i in range(n):
            x1, y1, w1, h1 = candidates[i][1]
            for j in range(i + 1, n):
                x2, y2, w2, h2 = candidates[j][1]
                # Gap between bounding boxes (negative = overlapping)
                gap_x = max(0, max(x1, x2) - min(x1 + w1, x2 + w2))
                gap_y = max(0, max(y1, y2) - min(y1 + h1, y2 + h2))
                if gap_x <= dist and gap_y <= dist:
                    union(i, j)

        # Group by root
        groups: dict[int, list[int]] = {}
        for i in range(n):
            root = find(i)
            groups.setdefault(root, []).append(i)

        # Build merged contours
        merged = []
        for indices in groups.values():
            if len(indices) == 1:
                merged.append(candidates[indices[0]])
            else:
                # Concatenate all contour points and compute combined bbox
                all_points = np.concatenate([candidates[i][0] for i in indices])
                combined_bbox = cv2.boundingRect(all_points)
                merged.append((all_points, combined_bbox))

        return merged


class CentroidTracker:
    """Tracks objects across frames via centroid matching with velocity prediction.

    Uses linear velocity estimation to predict where pieces should be when
    they briefly disappear (e.g. detection flicker). This is especially
    effective on a conveyor belt where motion is constant and linear.
    """

    def __init__(self, max_disappeared: int = 15, max_distance: int = 300):
        self.next_id: int = 0
        self.objects: dict[int, tuple[float, float]] = {}
        self.velocities: dict[int, tuple[float, float]] = {}
        self.disappeared: dict[int, int] = {}
        self.max_disappeared = max_disappeared
        self.max_distance = max_distance

    def _register(self, centroid: tuple[float, float]) -> int:
        object_id = self.next_id
        self.objects[object_id] = centroid
        self.velocities[object_id] = (0.0, 0.0)
        self.disappeared[object_id] = 0
        self.next_id += 1
        return object_id

    def _deregister(self, object_id: int) -> None:
        del self.objects[object_id]
        del self.velocities[object_id]
        del self.disappeared[object_id]

    def _predicted_positions(self) -> dict[int, tuple[float, float]]:
        """Predict where each object should be based on its velocity."""
        predicted = {}
        for oid, centroid in self.objects.items():
            vx, vy = self.velocities[oid]
            predicted[oid] = (centroid[0] + vx, centroid[1] + vy)
        return predicted

    def update(self, contours: list[Contour]) -> dict[int, tuple[float, float]]:
        """Match new contours to existing objects using predicted positions."""
        if len(contours) == 0:
            for oid in list(self.disappeared.keys()):
                self.disappeared[oid] += 1
                # Advance position by velocity while disappeared
                vx, vy = self.velocities[oid]
                cx, cy = self.objects[oid]
                self.objects[oid] = (cx + vx, cy + vy)
                if self.disappeared[oid] > self.max_disappeared:
                    self._deregister(oid)
            return dict(self.objects)

        input_centroids = [c.centroid for c in contours]

        if len(self.objects) == 0:
            for centroid in input_centroids:
                self._register(centroid)
            return dict(self.objects)

        # Use predicted positions for matching (not last-known positions)
        predicted = self._predicted_positions()
        object_ids = list(predicted.keys())
        object_centroids = list(predicted.values())

        # Compute distance matrix against predicted positions
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
            if dists[row, col] > self.max_distance:
                continue

            object_id = object_ids[row]
            new_centroid = input_centroids[col]
            old_centroid = self.objects[object_id]

            # Update velocity with exponential moving average
            dx = new_centroid[0] - old_centroid[0]
            dy = new_centroid[1] - old_centroid[1]
            old_vx, old_vy = self.velocities[object_id]
            alpha = 0.3
            self.velocities[object_id] = (
                alpha * dx + (1 - alpha) * old_vx,
                alpha * dy + (1 - alpha) * old_vy,
            )

            self.objects[object_id] = new_centroid
            self.disappeared[object_id] = 0
            used_rows.add(row)
            used_cols.add(col)

        # Handle unmatched existing objects - advance with velocity
        for row in range(len(object_centroids)):
            if row not in used_rows:
                oid = object_ids[row]
                self.disappeared[oid] += 1
                vx, vy = self.velocities[oid]
                cx, cy = self.objects[oid]
                self.objects[oid] = (cx + vx, cy + vy)
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
        self.velocities.clear()
        self.disappeared.clear()


class BestFrameSelector:
    """Picks the sharpest, most centred frame per tracked piece."""

    CROP_PADDING = 80  # pixels of padding around bounding box

    def __init__(self):
        self.piece_frames: dict[int, list[tuple[np.ndarray, float, float]]] = {}

    def add_frame(
        self,
        track_id: int,
        frame: np.ndarray,
        centroid: tuple[float, float],
        bounding_rect: tuple[int, int, int, int] | None,
        roi: tuple[int, int, int, int] | None,
    ) -> None:
        """Crop piece region, score by sharpness x centredness, and store."""
        if track_id not in self.piece_frames:
            self.piece_frames[track_id] = []

        # Crop to piece bounding box with padding
        crop = self._crop_piece(frame, bounding_rect) if bounding_rect else frame

        sharpness = self._laplacian_variance(crop)
        centredness = self._centredness_weight(centroid, roi) if roi else 1.0
        score = sharpness * centredness

        self.piece_frames[track_id].append((crop, score, sharpness))

    def get_best_frame(self, track_id: int) -> tuple[np.ndarray, float] | None:
        """Return highest-scoring cropped frame and its sharpness."""
        if track_id not in self.piece_frames or not self.piece_frames[track_id]:
            return None

        best = max(self.piece_frames[track_id], key=lambda x: x[1])
        return best[0], best[2]

    @classmethod
    def _crop_piece(cls, frame: np.ndarray, bbox: tuple[int, int, int, int]) -> np.ndarray:
        """Crop frame to bounding box with padding, clamped to frame bounds."""
        h, w = frame.shape[:2]
        x, y, bw, bh = bbox
        pad = cls.CROP_PADDING

        x1 = max(0, x - pad)
        y1 = max(0, y - pad)
        x2 = min(w, x + bw + pad)
        y2 = min(h, y + bh + pad)

        return frame[y1:y2, x1:x2].copy()

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
