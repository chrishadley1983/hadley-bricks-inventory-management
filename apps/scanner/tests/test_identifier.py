"""Tests for the identification module (F6, F7, E1-brickognize)."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import numpy as np
import pytest

from config import ScannerConfig
from identifier import (
    BrickognizeClient,
    build_error_result,
    build_identification_result,
    frame_to_jpeg_bytes,
    route_by_confidence,
)
from models import BrickognizeItem, BrickognizeResponse


class TestBrickognizeClient:
    """F6: Brickognize API integration."""

    @pytest.fixture
    def client(self, config: ScannerConfig) -> BrickognizeClient:
        return BrickognizeClient(config)

    @pytest.mark.asyncio
    async def test_identify_success(self, client: BrickognizeClient, jpeg_bytes: bytes):
        """Successful API call parses response into BrickognizeResponse."""
        api_response = {
            "id": "listing-001",
            "bounding_box": {"x": 0, "y": 0, "w": 100, "h": 100},
            "items": [
                {
                    "id": "3001",
                    "name": "Brick 2 x 4",
                    "score": 0.92,
                    "img_url": "https://example.com/3001.png",
                    "category": "Brick",
                    "type": "part",
                },
                {
                    "id": "3002",
                    "name": "Brick 2 x 3",
                    "score": 0.71,
                    "category": "Brick",
                    "type": "part",
                },
            ],
        }

        mock_resp = AsyncMock()
        mock_resp.status = 200
        mock_resp.json = AsyncMock(return_value=api_response)
        mock_ctx = MagicMock()
        mock_ctx.__aenter__ = AsyncMock(return_value=mock_resp)
        mock_ctx.__aexit__ = AsyncMock(return_value=False)

        mock_session = MagicMock()
        mock_session.closed = False
        mock_session.post = MagicMock(return_value=mock_ctx)

        with patch.object(client, "_get_session", return_value=mock_session):
            with patch("asyncio.sleep", new_callable=AsyncMock):
                result = await client.identify(jpeg_bytes)

        assert isinstance(result, BrickognizeResponse)
        assert result.listing_id == "listing-001"
        assert len(result.items) == 2
        assert result.items[0].id == "3001"
        assert result.items[0].score == 0.92

    @pytest.mark.asyncio
    async def test_identify_empty_items(self, client: BrickognizeClient, jpeg_bytes: bytes):
        """API returns empty items list when no match found."""
        api_response = {
            "id": "listing-002",
            "bounding_box": {"x": 0, "y": 0, "w": 50, "h": 50},
            "items": [],
        }

        mock_resp = AsyncMock()
        mock_resp.status = 200
        mock_resp.json = AsyncMock(return_value=api_response)
        mock_ctx = MagicMock()
        mock_ctx.__aenter__ = AsyncMock(return_value=mock_resp)
        mock_ctx.__aexit__ = AsyncMock(return_value=False)

        mock_session = MagicMock()
        mock_session.closed = False
        mock_session.post = MagicMock(return_value=mock_ctx)

        with patch.object(client, "_get_session", return_value=mock_session):
            with patch("asyncio.sleep", new_callable=AsyncMock):
                result = await client.identify(jpeg_bytes)

        assert isinstance(result, BrickognizeResponse)
        assert len(result.items) == 0

    @pytest.mark.asyncio
    async def test_identify_raises_on_persistent_500(self, client: BrickognizeClient, jpeg_bytes: bytes):
        """Raises RuntimeError after max retries on server error."""
        mock_resp = AsyncMock()
        mock_resp.status = 500
        mock_resp.text = AsyncMock(return_value="Internal Server Error")
        mock_ctx = MagicMock()
        mock_ctx.__aenter__ = AsyncMock(return_value=mock_resp)
        mock_ctx.__aexit__ = AsyncMock(return_value=False)

        mock_session = MagicMock()
        mock_session.closed = False
        mock_session.post = MagicMock(return_value=mock_ctx)

        with patch.object(client, "_get_session", return_value=mock_session):
            with patch("asyncio.sleep", new_callable=AsyncMock):
                with pytest.raises(RuntimeError, match="failed after"):
                    await client.identify(jpeg_bytes)

    def test_rate_limiter_semaphore(self, config: ScannerConfig):
        """Rate limiter uses configured max_rps."""
        config.brickognize_max_rps = 3
        client = BrickognizeClient(config)
        assert client._semaphore._value == 3


class TestConfidenceRouting:
    """F7: Confidence-based accept/flag routing."""

    def test_high_confidence_accepted(self, sample_brickognize_response: BrickognizeResponse):
        """High scoring response is accepted."""
        assert route_by_confidence(sample_brickognize_response, 0.70) == "accepted"

    def test_low_confidence_flagged(self):
        """Low scoring response is flagged."""
        response = BrickognizeResponse(
            listing_id="x",
            bounding_box={},
            items=[BrickognizeItem(id="3001", name="Brick", score=0.45)],
        )
        assert route_by_confidence(response, 0.70) == "flagged"

    def test_exact_threshold_accepted(self):
        """Score exactly at threshold is accepted."""
        response = BrickognizeResponse(
            listing_id="x",
            bounding_box={},
            items=[BrickognizeItem(id="3001", name="Brick", score=0.70)],
        )
        assert route_by_confidence(response, 0.70) == "accepted"

    def test_empty_items_flagged(self):
        """Empty items list is flagged."""
        response = BrickognizeResponse(listing_id="x", bounding_box={}, items=[])
        assert route_by_confidence(response, 0.70) == "flagged"

    def test_custom_threshold(self):
        """Custom threshold changes routing."""
        response = BrickognizeResponse(
            listing_id="x",
            bounding_box={},
            items=[BrickognizeItem(id="3001", name="Brick", score=0.85)],
        )
        assert route_by_confidence(response, 0.90) == "flagged"
        assert route_by_confidence(response, 0.80) == "accepted"


class TestBuildResults:
    """Helper functions for building IdentificationResult."""

    def test_build_identification_result(self, sample_brickognize_response: BrickognizeResponse):
        result = build_identification_result(
            track_id=5,
            response=sample_brickognize_response,
            threshold=0.70,
            image_bytes=b"jpeg-data",
            frame_sharpness=120.5,
        )

        assert result.track_id == 5
        assert result.brickognize_item_id == "3001"
        assert result.item_name == "Brick 2 x 4"
        assert result.confidence == 0.92
        assert result.status == "accepted"
        assert len(result.top_results) == 2
        assert result.image_bytes == b"jpeg-data"
        assert result.frame_sharpness == 120.5

    def test_build_identification_result_flagged(self):
        response = BrickognizeResponse(
            listing_id="x",
            bounding_box={},
            items=[BrickognizeItem(id="9999", name="Unknown", score=0.30)],
        )
        result = build_identification_result(
            track_id=1,
            response=response,
            threshold=0.70,
            image_bytes=b"",
            frame_sharpness=0.0,
        )
        assert result.status == "flagged"

    def test_build_error_result(self):
        result = build_error_result(track_id=3, error_message="API timeout")
        assert result.track_id == 3
        assert result.status == "error"
        assert result.error_message == "API timeout"
        assert result.confidence == 0.0


class TestFrameToJpeg:
    """Utility: frame to JPEG bytes."""

    def test_encodes_frame(self, sample_frame: np.ndarray):
        data = frame_to_jpeg_bytes(sample_frame)
        assert isinstance(data, bytes)
        assert len(data) > 0
        # JPEG magic bytes
        assert data[:2] == b"\xff\xd8"
