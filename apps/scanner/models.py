"""Pydantic models for the LEGO scanner pipeline."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict


class BrickognizeItem(BaseModel):
    """A single candidate item from the Brickognize API."""

    id: str
    name: str
    score: float
    img_url: str | None = None
    category: str | None = None
    type: str | None = None
    external_sites: list[dict[str, Any]] | None = None


class BrickognizeResponse(BaseModel):
    """Parsed response from Brickognize /predict/parts/ endpoint."""

    listing_id: str
    bounding_box: dict[str, Any]
    items: list[BrickognizeItem]


class IdentificationResult(BaseModel):
    """Result of identifying a single tracked piece."""

    model_config = ConfigDict(arbitrary_types_allowed=True)

    track_id: int
    brickognize_item_id: str | None = None
    brickognize_listing_id: str | None = None
    item_name: str | None = None
    item_category: str | None = None
    confidence: float = 0.0
    status: Literal["accepted", "flagged", "rejected", "error"] = "flagged"
    top_results: list[BrickognizeItem] = []
    image_bytes: bytes = b""
    frame_sharpness: float = 0.0
    error_message: str | None = None


class SessionSummary(BaseModel):
    """Summary statistics for a completed scanner session."""

    total_pieces: int = 0
    accepted_count: int = 0
    flagged_count: int = 0
    error_count: int = 0
    unique_parts: int = 0
    duration_seconds: float = 0.0
    pieces_per_minute: float = 0.0


class CalibrationResult(BaseModel):
    """Output of the calibration flow."""

    model_config = ConfigDict(arbitrary_types_allowed=True)

    background_frames: list[Any] = []  # numpy arrays
    roi: tuple[int, int, int, int] = (0, 0, 0, 0)  # x, y, w, h
    lighting_ok: bool = True
    lighting_warning: str | None = None
    contrast_ok: bool = True
    contrast_warning: str | None = None


class Contour(BaseModel):
    """A detected contour with its properties."""

    model_config = ConfigDict(arbitrary_types_allowed=True)

    contour: Any  # numpy array
    area: float
    centroid: tuple[float, float]
    bounding_rect: tuple[int, int, int, int]  # x, y, w, h
