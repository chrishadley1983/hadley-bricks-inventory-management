"""Identification module: Brickognize API client with rate limiting and confidence routing."""

from __future__ import annotations

import asyncio
import io
import logging

import aiohttp
from PIL import Image

from config import ScannerConfig
from models import BrickognizeItem, BrickognizeResponse, IdentificationResult

logger = logging.getLogger(__name__)

BRICKOGNIZE_URL = "https://api.brickognize.com/predict/parts/"


class BrickognizeClient:
    """Async client for the Brickognize /predict/parts/ API."""

    def __init__(self, config: ScannerConfig):
        self._semaphore = asyncio.Semaphore(config.brickognize_max_rps)
        self._delay = 1.0 / config.brickognize_max_rps
        self._top_n = config.brickognize_top_n
        self._max_retries = 3
        self._session: aiohttp.ClientSession | None = None

    async def _get_session(self) -> aiohttp.ClientSession:
        if self._session is None or self._session.closed:
            timeout = aiohttp.ClientTimeout(total=30)
            self._session = aiohttp.ClientSession(timeout=timeout)
        return self._session

    async def identify(self, image_bytes: bytes) -> BrickognizeResponse:
        """POST image to /predict/parts/, return parsed response."""
        async with self._semaphore:
            for attempt in range(self._max_retries):
                try:
                    session = await self._get_session()
                    data = aiohttp.FormData()
                    data.add_field(
                        "query_image",
                        image_bytes,
                        filename="piece.jpg",
                        content_type="image/jpeg",
                    )

                    async with session.post(BRICKOGNIZE_URL, data=data) as resp:
                        if resp.status >= 500:
                            delay = (2 ** attempt) * 0.5
                            logger.warning(
                                f"Brickognize {resp.status} (attempt {attempt + 1}). "
                                f"Retrying in {delay}s"
                            )
                            await asyncio.sleep(delay)
                            continue

                        if resp.status != 200:
                            body = await resp.text()
                            raise RuntimeError(
                                f"Brickognize API error {resp.status}: {body}"
                            )

                        body = await resp.json()

                except (aiohttp.ClientError, asyncio.TimeoutError) as e:
                    if attempt < self._max_retries - 1:
                        delay = (2 ** attempt) * 0.5
                        logger.warning(
                            f"Brickognize request failed (attempt {attempt + 1}): {e}. "
                            f"Retrying in {delay}s"
                        )
                        await asyncio.sleep(delay)
                        continue
                    raise
                else:
                    break
            else:
                raise RuntimeError(
                    f"Brickognize API failed after {self._max_retries} retries"
                )

            await asyncio.sleep(self._delay)

            # Parse response
            items = []
            for item_data in body.get("items", [])[:self._top_n]:
                items.append(
                    BrickognizeItem(
                        id=str(item_data.get("id", "")),
                        name=item_data.get("name", "Unknown"),
                        score=float(item_data.get("score", 0)),
                        img_url=item_data.get("img_url"),
                        category=item_data.get("category"),
                        type=item_data.get("type"),
                        external_sites=item_data.get("external_sites"),
                    )
                )

            return BrickognizeResponse(
                listing_id=str(body.get("id", "")),
                bounding_box=body.get("bounding_box", {}),
                items=items,
            )

    async def close(self) -> None:
        if self._session and not self._session.closed:
            await self._session.close()


def route_by_confidence(
    result: BrickognizeResponse, threshold: float
) -> str:
    """Return 'accepted' or 'flagged' based on top result score."""
    if result.items and result.items[0].score >= threshold:
        return "accepted"
    return "flagged"


def build_identification_result(
    track_id: int,
    response: BrickognizeResponse,
    threshold: float,
    image_bytes: bytes,
    frame_sharpness: float,
) -> IdentificationResult:
    """Build an IdentificationResult from a Brickognize response."""
    status = route_by_confidence(response, threshold)
    top_item = response.items[0] if response.items else None

    return IdentificationResult(
        track_id=track_id,
        brickognize_item_id=top_item.id if top_item else None,
        brickognize_listing_id=response.listing_id,
        item_name=top_item.name if top_item else None,
        item_category=top_item.category if top_item else None,
        confidence=top_item.score if top_item else 0.0,
        status=status,
        top_results=response.items,
        image_bytes=image_bytes,
        frame_sharpness=frame_sharpness,
    )


def build_error_result(
    track_id: int, error_message: str, image_bytes: bytes = b"", frame_sharpness: float = 0.0
) -> IdentificationResult:
    """Build an error IdentificationResult."""
    return IdentificationResult(
        track_id=track_id,
        status="error",
        image_bytes=image_bytes,
        frame_sharpness=frame_sharpness,
        error_message=error_message,
    )


def frame_to_jpeg_bytes(frame) -> bytes:
    """Convert a numpy frame to JPEG bytes."""
    import cv2
    success, buffer = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 85])
    if not success:
        raise ValueError("Failed to encode frame as JPEG")
    return buffer.tobytes()
