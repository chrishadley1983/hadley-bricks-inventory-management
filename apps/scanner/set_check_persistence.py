"""Set-check persistence: Supabase storage for set-check sessions and progress."""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from typing import Any

from supabase import Client

logger = logging.getLogger(__name__)


class SetCheckPersistence:
    """Persists set-check session data to Supabase."""

    def __init__(self, supabase_client: Client, session_id: str):
        self.supabase = supabase_client
        self.session_id = session_id
        self.set_check_session_id: str | None = None

    async def create_set_check_session(
        self,
        set_num: str,
        set_name: str,
        set_year: int | None,
        total_expected: int,
        total_unique: int,
        spare_count: int,
        parts_json: list[dict],
    ) -> str:
        """Insert a row into scanner_set_check_sessions. Returns set_check_session_id."""
        result = await asyncio.to_thread(
            lambda: self.supabase.table("scanner_set_check_sessions").insert({
                "session_id": self.session_id,
                "set_num": set_num,
                "set_name": set_name,
                "set_year": set_year,
                "total_expected": total_expected,
                "total_unique": total_unique,
                "spare_count": spare_count,
                "parts_json": parts_json,
            }).execute()
        )
        self.set_check_session_id = result.data[0]["id"]
        logger.info(f"Set-check session created: {self.set_check_session_id} for set {set_num}")
        return self.set_check_session_id

    async def persist_progress(
        self,
        part_num: str,
        color_id: int,
        color_name: str,
        expected_qty: int,
        found_qty: int,
        is_spare: bool,
    ) -> None:
        """Upsert a progress row for the current set-check session."""
        if not self.set_check_session_id:
            logger.warning("persist_progress called before create_set_check_session")
            return

        await asyncio.to_thread(
            lambda: self.supabase.table("scanner_set_check_progress").upsert(
                {
                    "set_check_session_id": self.set_check_session_id,
                    "part_num": part_num,
                    "color_id": color_id,
                    "color_name": color_name,
                    "expected_qty": expected_qty,
                    "found_qty": found_qty,
                    "is_spare": is_spare,
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                },
                on_conflict="set_check_session_id,part_num,color_id",
            ).execute()
        )
        logger.debug(f"Progress persisted: {part_num} color={color_id} found={found_qty}/{expected_qty}")

    async def load_progress(self, set_check_session_id: str) -> list[dict[str, Any]]:
        """Return all progress rows for the given set-check session."""
        result = await asyncio.to_thread(
            lambda: self.supabase.table("scanner_set_check_progress")
            .select("*")
            .eq("set_check_session_id", set_check_session_id)
            .execute()
        )
        return result.data or []

    async def find_incomplete_session(self, set_num: str) -> str | None:
        """Find the most recent incomplete set-check session for a given set number.

        A session is incomplete if the linked scanner_sessions.status != 'completed'.
        Returns the set_check_session_id, or None if not found.
        """
        # Join via session_id to check scanner_sessions.status
        result = await asyncio.to_thread(
            lambda: self.supabase.table("scanner_set_check_sessions")
            .select("id, session_id, scanner_sessions!inner(status)")
            .eq("set_num", set_num)
            .neq("scanner_sessions.status", "completed")
            .order("created_at", desc=True)
            .limit(1)
            .execute()
        )

        if result.data:
            session_id = result.data[0]["id"]
            logger.info(f"Found incomplete set-check session {session_id} for set {set_num}")
            return session_id

        return None
