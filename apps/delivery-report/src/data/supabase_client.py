"""Supabase data access — order queries, cache CRUD, job execution logging."""

import logging
from datetime import datetime, timedelta

from supabase import Client, create_client

from src.config import SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL

log = logging.getLogger(__name__)

_client: Client | None = None


def get_client() -> Client:
    global _client
    if _client is None:
        _client = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    return _client


# ── Order queries ────────────────────────────────────────────────────────


def get_cancelled_order_ids(days: int = 28) -> set[str]:
    """Get order IDs with Canceled status in the given window."""
    cutoff = (datetime.now() - timedelta(days=days)).strftime("%Y-%m-%d")
    cancelled = set()
    page_size = 1000
    offset = 0

    while True:
        result = (
            get_client()
            .table("platform_orders")
            .select("platform_order_id, raw_data")
            .eq("platform", "amazon")
            .gt("order_date", cutoff)
            .range(offset, offset + page_size - 1)
            .execute()
        )
        rows = result.data or []
        for row in rows:
            raw = row.get("raw_data") or {}
            if raw.get("OrderStatus") == "Canceled":
                cancelled.add(row["platform_order_id"])

        if len(rows) < page_size:
            break
        offset += page_size

    return cancelled


def get_active_orders(days: int = 28) -> list[dict]:
    """Get all Amazon orders in the given window, paginating past 1000-row limit."""
    cutoff = (datetime.now() - timedelta(days=days)).strftime("%Y-%m-%d")
    all_orders = []
    page_size = 1000
    offset = 0

    while True:
        result = (
            get_client()
            .table("platform_orders")
            .select("platform_order_id, order_date, dispatch_by, raw_data")
            .eq("platform", "amazon")
            .gt("order_date", cutoff)
            .order("order_date", desc=True)
            .range(offset, offset + page_size - 1)
            .execute()
        )
        rows = result.data or []
        for row in rows:
            raw = row.get("raw_data") or {}
            all_orders.append(
                {
                    "platform_order_id": row["platform_order_id"],
                    "order_date": row["order_date"],
                    "dispatch_by": row.get("dispatch_by"),
                    "expected_delivery": raw.get("LatestDeliveryDate"),
                    "order_status": raw.get("OrderStatus"),
                }
            )

        if len(rows) < page_size:
            break
        offset += page_size

    log.info("Fetched %d Amazon orders from Supabase", len(all_orders))
    return all_orders


# ── Cache CRUD ───────────────────────────────────────────────────────────


def get_cached_orders() -> dict[str, dict]:
    """Load all rows from delivery_tracking_cache into a dict keyed by platform_order_id."""
    all_rows = []
    page_size = 1000
    offset = 0

    while True:
        result = (
            get_client()
            .table("delivery_tracking_cache")
            .select("*")
            .range(offset, offset + page_size - 1)
            .execute()
        )
        rows = result.data or []
        all_rows.extend(rows)
        if len(rows) < page_size:
            break
        offset += page_size

    log.info("Loaded %d cached orders from Supabase", len(all_rows))
    return {row["platform_order_id"]: row for row in all_rows}


def upsert_cache(orders: list[dict]) -> None:
    """Upsert orders into the delivery_tracking_cache table."""
    if not orders:
        return
    # Batch in groups of 100
    for i in range(0, len(orders), 100):
        batch = orders[i : i + 100]
        get_client().table("delivery_tracking_cache").upsert(
            batch, on_conflict="platform_order_id"
        ).execute()
    log.info("Upserted %d orders to delivery_tracking_cache", len(orders))


def delete_cache_entries(order_ids: list[str]) -> None:
    """Delete specific entries from the cache (e.g. phantom orders)."""
    if not order_ids:
        return
    for oid in order_ids:
        get_client().table("delivery_tracking_cache").delete().eq(
            "platform_order_id", oid
        ).execute()
    log.info("Deleted %d phantom entries from cache", len(order_ids))


def prune_old_cache(days: int = 35) -> int:
    """Remove cache entries older than the given number of days."""
    cutoff = (datetime.now() - timedelta(days=days)).strftime("%Y-%m-%d")
    result = (
        get_client()
        .table("delivery_tracking_cache")
        .delete()
        .lt("order_date", cutoff)
        .execute()
    )
    count = len(result.data or [])
    if count:
        log.info("Pruned %d old cache entries (older than %d days)", count, days)
    return count


# ── Cache validation ─────────────────────────────────────────────────────


def validate_cache_against_supabase(cache_order_ids: list[str]) -> list[str]:
    """Return order IDs that exist in cache but NOT in platform_orders (phantoms)."""
    if not cache_order_ids:
        return []

    # Query in batches of 100 to avoid URL length limits
    existing = set()
    for i in range(0, len(cache_order_ids), 100):
        batch = cache_order_ids[i : i + 100]
        result = (
            get_client()
            .table("platform_orders")
            .select("platform_order_id")
            .in_("platform_order_id", batch)
            .execute()
        )
        existing.update(row["platform_order_id"] for row in result.data or [])

    phantoms = [oid for oid in cache_order_ids if oid not in existing]
    if phantoms:
        log.warning("Found %d phantom cache entries not in Supabase", len(phantoms))
    return phantoms


# ── Job execution logging ────────────────────────────────────────────────


def log_job_start() -> str:
    """Log a job execution start and return the row ID."""
    result = (
        get_client()
        .table("job_execution_history")
        .insert({"job_name": "delivery-report", "trigger": "cron", "status": "running"})
        .execute()
    )
    row_id = result.data[0]["id"]
    log.info("Job started, execution ID: %s", row_id)
    return row_id


def log_job_complete(
    job_id: str,
    items_processed: int = 0,
    result_summary: dict | None = None,
) -> None:
    """Log a successful job completion."""
    get_client().table("job_execution_history").update(
        {
            "status": "completed",
            "completed_at": datetime.now().isoformat(),
            "items_processed": items_processed,
            "result_summary": result_summary,
        }
    ).eq("id", job_id).execute()


def log_job_failed(job_id: str, error_message: str) -> None:
    """Log a failed job execution."""
    get_client().table("job_execution_history").update(
        {
            "status": "failed",
            "completed_at": datetime.now().isoformat(),
            "error_message": error_message[:2000],
        }
    ).eq("id", job_id).execute()
