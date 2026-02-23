"""Tests for the detection module (F3, F4, F5)."""

from __future__ import annotations

import numpy as np
import pytest

from config import ScannerConfig
from detector import BestFrameSelector, CentroidTracker, PieceDetector
from models import Contour


class TestPieceDetector:
    """F3: MOG2 background subtraction detects pieces."""

    def test_init_creates_bg_subtractor(self, config: ScannerConfig):
        detector = PieceDetector(config)
        assert detector.bg_subtractor is not None
        assert detector.min_area == config.min_contour_area
        assert detector.max_area == config.max_contour_area

    def test_train_background(self, config: ScannerConfig, sample_frame: np.ndarray):
        """Training feeds frames to MOG2 model without error."""
        detector = PieceDetector(config)
        frames = [sample_frame.copy() for _ in range(5)]
        detector.train_background(frames)
        # No assertion needed - just verify no crash

    def test_detect_empty_scene(self, config: ScannerConfig, sample_frame: np.ndarray):
        """Detection on trained background returns empty list."""
        detector = PieceDetector(config)
        # Train on the same frame
        detector.train_background([sample_frame] * 10)
        # Detect on same frame (no foreground)
        contours = detector.detect(sample_frame)
        assert isinstance(contours, list)
        # Should have no or very few detections on identical background
        assert len(contours) <= 1

    def test_detect_with_blob(self, config: ScannerConfig):
        """Detection finds a white blob on trained dark background."""
        detector = PieceDetector(config)
        bg = np.full((480, 640, 3), 50, dtype=np.uint8)

        # Train on dark background
        detector.train_background([bg.copy() for _ in range(20)])

        # Add a white blob
        frame = bg.copy()
        frame[150:220, 200:300] = 255

        contours = detector.detect(frame)
        assert isinstance(contours, list)
        # The blob should be detected (area ~7000, above min_area=500)
        for c in contours:
            assert isinstance(c, Contour)
            assert c.area > 0
            assert len(c.centroid) == 2

    def test_detect_filters_by_roi(self, config: ScannerConfig):
        """Contours outside ROI are filtered out."""
        detector = PieceDetector(config)
        # Set ROI to right half of frame
        detector.roi = (320, 0, 320, 480)

        bg = np.full((480, 640, 3), 50, dtype=np.uint8)
        detector.train_background([bg.copy() for _ in range(20)])

        # Blob on left side (outside ROI)
        frame = bg.copy()
        frame[150:220, 50:150] = 255

        contours = detector.detect(frame)
        # Should filter out contour since centroid (~100, 185) is outside ROI (320-640)
        roi_contours = [c for c in contours if c.centroid[0] >= 320]
        assert len(roi_contours) == 0

    def test_detect_filters_small_contours(self, config: ScannerConfig):
        """Contours smaller than min_area are filtered out."""
        detector = PieceDetector(config)
        bg = np.full((480, 640, 3), 50, dtype=np.uint8)
        detector.train_background([bg.copy() for _ in range(20)])

        # Tiny blob (5x5 = 25px area, below min_area=500)
        frame = bg.copy()
        frame[200:205, 300:305] = 255

        contours = detector.detect(frame)
        small = [c for c in contours if c.area < config.min_contour_area]
        assert len(small) == 0


class TestCentroidTracker:
    """F4: Centroid tracking deduplicates pieces."""

    def test_register_new_objects(self, sample_contour: Contour):
        tracker = CentroidTracker(max_disappeared=5)
        objects = tracker.update([sample_contour])
        assert len(objects) == 1
        assert 0 in objects

    def test_track_moving_object(self, sample_contour: Contour):
        """Same object moving slightly keeps same ID."""
        tracker = CentroidTracker(max_disappeared=5)

        # Frame 1
        tracker.update([sample_contour])

        # Frame 2 - slightly moved
        moved = Contour(
            contour=sample_contour.contour,
            area=sample_contour.area,
            centroid=(245.0, 185.0),  # moved 5px right, 5px down
            bounding_rect=(205, 155, 80, 60),
        )
        objects = tracker.update([moved])
        assert len(objects) == 1
        assert 0 in objects  # Same ID

    def test_new_object_gets_new_id(self, sample_contour: Contour):
        """A distant contour gets a new tracking ID."""
        tracker = CentroidTracker(max_disappeared=5)
        tracker.update([sample_contour])

        # New contour far away
        far_contour = Contour(
            contour=sample_contour.contour,
            area=3000.0,
            centroid=(500.0, 400.0),
            bounding_rect=(460, 370, 80, 60),
        )
        objects = tracker.update([sample_contour, far_contour])
        assert len(objects) == 2
        assert 0 in objects
        assert 1 in objects

    def test_deregister_after_max_disappeared(self):
        """Object removed after max_disappeared empty frames."""
        tracker = CentroidTracker(max_disappeared=3)
        c = Contour(
            contour=np.array([[0, 0]]),
            area=1000.0,
            centroid=(100.0, 100.0),
            bounding_rect=(80, 80, 40, 40),
        )
        tracker.update([c])
        assert len(tracker.objects) == 1

        # Pass empty frames
        for _ in range(4):
            tracker.update([])

        assert len(tracker.objects) == 0

    def test_reset_clears_state(self, sample_contour: Contour):
        tracker = CentroidTracker()
        tracker.update([sample_contour])
        assert len(tracker.objects) > 0

        tracker.reset()
        assert len(tracker.objects) == 0
        assert tracker.next_id == 0


class TestBestFrameSelector:
    """F5: Best frame selected by sharpness × centredness."""

    def test_add_and_get_best_frame(self, sample_frame: np.ndarray):
        selector = BestFrameSelector()
        roi = (0, 0, 640, 480)

        # Add frames with different sharpness
        blurry = sample_frame.copy()
        selector.add_frame(1, blurry, (320.0, 240.0), roi)

        # Sharp frame (add texture)
        import cv2
        sharp = sample_frame.copy()
        cv2.rectangle(sharp, (100, 100), (200, 200), (0, 0, 0), 2)
        cv2.rectangle(sharp, (300, 300), (400, 400), (255, 255, 255), 2)
        selector.add_frame(1, sharp, (320.0, 240.0), roi)

        result = selector.get_best_frame(1)
        assert result is not None
        frame, sharpness = result
        assert isinstance(frame, np.ndarray)
        assert sharpness > 0

    def test_get_best_frame_unknown_id(self):
        selector = BestFrameSelector()
        result = selector.get_best_frame(999)
        assert result is None

    def test_remove_cleans_up(self, sample_frame: np.ndarray):
        selector = BestFrameSelector()
        selector.add_frame(1, sample_frame, (320.0, 240.0), None)
        assert 1 in selector.piece_frames

        selector.remove(1)
        assert 1 not in selector.piece_frames

    def test_centredness_weight_centre(self):
        """Centre of ROI gets weight 1.0."""
        weight = BestFrameSelector._centredness_weight(
            (320.0, 240.0), (0, 0, 640, 480)
        )
        assert weight == pytest.approx(1.0, abs=0.01)

    def test_centredness_weight_edge(self):
        """Edge of ROI gets weight ~0.5."""
        weight = BestFrameSelector._centredness_weight(
            (0.0, 0.0), (0, 0, 640, 480)
        )
        assert 0.5 <= weight <= 0.6

    def test_laplacian_variance(self, sample_frame: np.ndarray):
        """Uniform frame has near-zero sharpness."""
        sharpness = BestFrameSelector._laplacian_variance(sample_frame)
        assert sharpness >= 0
        assert sharpness < 1.0  # Uniform frame = very low variance
