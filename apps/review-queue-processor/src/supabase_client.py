"""Supabase client — read queue items and dismiss non-LEGO items."""

import logging

from supabase import create_client

from src.config import SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

log = logging.getLogger(__name__)

_client = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

PAGE_SIZE = 500


def fetch_skipped_items() -> list[dict]:
    """Fetch all processed_purchase_emails with status='skipped', paginated."""
    all_items: list[dict] = []
    offset = 0

    while True:
        response = (
            _client.table("processed_purchase_emails")
            .select("*")
            .eq("status", "skipped")
            .order("email_date", desc=True)
            .range(offset, offset + PAGE_SIZE - 1)
            .execute()
        )
        batch = response.data or []
        all_items.extend(batch)

        if len(batch) < PAGE_SIZE:
            break
        offset += PAGE_SIZE

    log.info("Fetched %d skipped items from review queue", len(all_items))
    return all_items


def dismiss_item(item_id: str) -> None:
    """Mark a review queue item as manual_skip (non-LEGO)."""
    _client.table("processed_purchase_emails").update(
        {"status": "manual_skip"}
    ).eq("id", item_id).execute()
    log.info("Dismissed item %s as manual_skip", item_id)
