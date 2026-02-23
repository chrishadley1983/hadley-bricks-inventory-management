"""Session module: lifecycle, Supabase persistence, image upload, summary, export."""

from __future__ import annotations

import csv
import json
import logging
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

from supabase import create_client, Client

from config import ScannerConfig
from models import IdentificationResult, SessionSummary

logger = logging.getLogger(__name__)


class SessionManager:
    """Manages scanner session lifecycle and Supabase persistence."""

    def __init__(self, config: ScannerConfig):
        self.supabase: Client = create_client(config.supabase_url, config.supabase_key)
        self.session_id: str | None = None
        self.user_id: str = config.user_id
        self.pieces: list[IdentificationResult] = []
        self.start_time: datetime | None = None
        self._config = config

    async def start(self, confidence_threshold: float, camera_config: dict) -> str:
        """Create scanner_sessions row with status='calibrating'. Returns session_id."""
        self.start_time = datetime.now(timezone.utc)

        result = self.supabase.table("scanner_sessions").insert({
            "user_id": self.user_id,
            "status": "calibrating",
            "confidence_threshold": confidence_threshold,
            "camera_config_json": camera_config,
        }).execute()

        self.session_id = result.data[0]["id"]
        logger.info(f"Session started: {self.session_id}")
        return self.session_id

    async def update_status(self, status: str) -> None:
        """Update session status."""
        if not self.session_id:
            return
        self.supabase.table("scanner_sessions").update({
            "status": status,
        }).eq("id", self.session_id).execute()
        logger.info(f"Session status: {status}")

    async def record_piece(self, result: IdentificationResult) -> str:
        """Insert scanner_pieces row + upload image to storage. Returns piece_id."""
        if not self.session_id:
            raise RuntimeError("Session not started")

        self.pieces.append(result)

        # Generate piece ID for storage path
        piece_data = {
            "session_id": self.session_id,
            "brickognize_item_id": result.brickognize_item_id,
            "brickognize_listing_id": result.brickognize_listing_id,
            "item_name": result.item_name,
            "item_category": result.item_category,
            "confidence": float(result.confidence) if result.confidence else None,
            "status": result.status,
            "top_results_json": [r.model_dump() for r in result.top_results],
            "frame_sharpness": float(result.frame_sharpness) if result.frame_sharpness else None,
        }

        insert_result = self.supabase.table("scanner_pieces").insert(piece_data).execute()
        piece_id = insert_result.data[0]["id"]

        # Upload image to storage
        if result.image_bytes:
            image_path = f"{self.session_id}/{piece_id}.jpg"
            try:
                self.supabase.storage.from_("scanner-images").upload(
                    image_path,
                    result.image_bytes,
                    file_options={"content-type": "image/jpeg"},
                )
                # Update piece with image path
                self.supabase.table("scanner_pieces").update({
                    "image_path": image_path,
                }).eq("id", piece_id).execute()
            except Exception as e:
                logger.warning(f"Failed to upload image for piece {piece_id}: {e}")

        logger.info(
            f"Piece recorded: {result.item_name} "
            f"({result.confidence:.2f}) [{result.status}]"
        )
        return piece_id

    async def end(self) -> SessionSummary:
        """Update session with ended_at + summary_json. Return summary."""
        if not self.session_id or not self.start_time:
            raise RuntimeError("Session not started")

        end_time = datetime.now(timezone.utc)
        duration = (end_time - self.start_time).total_seconds()

        summary = self._build_summary(duration)

        self.supabase.table("scanner_sessions").update({
            "ended_at": end_time.isoformat(),
            "status": "completed",
            "summary_json": summary.model_dump(),
        }).eq("id", self.session_id).execute()

        logger.info(f"Session ended: {summary.total_pieces} pieces in {duration:.0f}s")
        return summary

    async def abort(self) -> None:
        """Abort the session."""
        if not self.session_id:
            return
        self.supabase.table("scanner_sessions").update({
            "ended_at": datetime.now(timezone.utc).isoformat(),
            "status": "aborted",
        }).eq("id", self.session_id).execute()

    def _build_summary(self, duration_seconds: float) -> SessionSummary:
        """Build summary from recorded pieces."""
        total = len(self.pieces)
        accepted = sum(1 for p in self.pieces if p.status == "accepted")
        flagged = sum(1 for p in self.pieces if p.status == "flagged")
        errors = sum(1 for p in self.pieces if p.status == "error")
        unique_ids = set(
            p.brickognize_item_id for p in self.pieces
            if p.brickognize_item_id is not None
        )
        ppm = (total / duration_seconds * 60) if duration_seconds > 0 else 0

        return SessionSummary(
            total_pieces=total,
            accepted_count=accepted,
            flagged_count=flagged,
            error_count=errors,
            unique_parts=len(unique_ids),
            duration_seconds=duration_seconds,
            pieces_per_minute=round(ppm, 1),
        )

    def export_json(self, output_path: Path) -> None:
        """Write consolidated results as JSON (grouped by part ID)."""
        output_path.parent.mkdir(parents=True, exist_ok=True)

        consolidated: dict[str, dict] = {}
        for piece in self.pieces:
            pid = piece.brickognize_item_id or f"unknown_{piece.track_id}"
            if pid not in consolidated:
                consolidated[pid] = {
                    "part_id": pid,
                    "name": piece.item_name,
                    "category": piece.item_category,
                    "quantity": 0,
                    "total_confidence": 0.0,
                    "top_results": [r.model_dump() for r in piece.top_results],
                }
            consolidated[pid]["quantity"] += 1
            consolidated[pid]["total_confidence"] += piece.confidence

        # Calculate averages
        for entry in consolidated.values():
            if entry["quantity"] > 0:
                entry["avg_confidence"] = round(
                    entry["total_confidence"] / entry["quantity"], 3
                )
            del entry["total_confidence"]

        output_path.write_text(
            json.dumps(list(consolidated.values()), indent=2), encoding="utf-8"
        )
        logger.info(f"JSON exported: {output_path}")

    def export_csv(self, output_path: Path) -> None:
        """Write flat CSV: part_id, name, category, quantity, avg_confidence."""
        output_path.parent.mkdir(parents=True, exist_ok=True)

        consolidated: dict[str, dict] = {}
        for piece in self.pieces:
            pid = piece.brickognize_item_id or f"unknown_{piece.track_id}"
            if pid not in consolidated:
                consolidated[pid] = {
                    "part_id": pid,
                    "name": piece.item_name or "",
                    "category": piece.item_category or "",
                    "quantity": 0,
                    "total_confidence": 0.0,
                }
            consolidated[pid]["quantity"] += 1
            consolidated[pid]["total_confidence"] += piece.confidence

        rows = []
        for entry in consolidated.values():
            avg_conf = (
                round(entry["total_confidence"] / entry["quantity"], 3)
                if entry["quantity"] > 0
                else 0
            )
            rows.append({
                "part_id": entry["part_id"],
                "name": entry["name"],
                "category": entry["category"],
                "quantity": entry["quantity"],
                "avg_confidence": avg_conf,
            })

        with open(output_path, "w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(
                f, fieldnames=["part_id", "name", "category", "quantity", "avg_confidence"]
            )
            writer.writeheader()
            writer.writerows(rows)

        logger.info(f"CSV exported: {output_path}")
