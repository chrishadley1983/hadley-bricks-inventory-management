"""Join Supabase orders with Click & Drop tracking data."""

import logging
from datetime import date, datetime, timedelta

log = logging.getLogger(__name__)


def match_orders(
    supabase_orders: list[dict],
    click_drop_tracking: dict[str, dict],
    cancelled_ids: set[str],
    cache: dict[str, dict],
    stale_no_tracking_days: int = 21,
) -> list[dict]:
    """
    Join Supabase orders with Click & Drop tracking data.

    Args:
        supabase_orders: Orders from platform_orders table
        click_drop_tracking: Dict of order_id -> {tracking, cd_status, despatch_date}
        cancelled_ids: Order IDs to exclude
        cache: Existing cache for item_name fallback
        stale_no_tracking_days: Remove no-tracking orders older than this

    Returns:
        List of merged order dicts ready for processing
    """
    today = date.today()
    stale_cutoff = today - timedelta(days=stale_no_tracking_days)
    merged = []

    for order in supabase_orders:
        oid = order["platform_order_id"]

        # Skip cancelled orders
        if oid in cancelled_ids:
            continue

        # Skip orders with Canceled status
        if order.get("order_status") == "Canceled":
            continue

        # Look up tracking from Click & Drop
        cd = click_drop_tracking.get(oid, {})
        tracking = cd.get("tracking") or None

        # Also check cache for tracking if CD doesn't have it
        cached = cache.get(oid, {})
        if not tracking:
            tracking = cached.get("tracking_number")

        # Parse expected_delivery from ISO timestamp to date string
        expected = order.get("expected_delivery")
        if expected and "T" in str(expected):
            expected = str(expected)[:10]

        # Item name: prefer order_items join, fall back to cache
        item_name = order.get("item_name") or cached.get("item_name") or "Unknown"

        merged_order = {
            "platform_order_id": oid,
            "order_date": order.get("order_date"),
            "dispatch_by": order.get("dispatch_by"),
            "item_name": item_name,
            "expected_delivery": expected,
            "tracking_number": tracking,
            "cd_status": cd.get("cd_status"),
        }

        # Filter out stale no-tracking orders
        if not tracking:
            order_date_str = order.get("order_date")
            if order_date_str:
                try:
                    order_date = datetime.strptime(str(order_date_str)[:10], "%Y-%m-%d").date()
                    if order_date < stale_cutoff:
                        log.debug("Skipping stale no-tracking order %s (date: %s)", oid, order_date)
                        continue
                except ValueError:
                    pass

        merged.append(merged_order)

    log.info(
        "Matched %d orders (%d had tracking, %d without)",
        len(merged),
        sum(1 for m in merged if m.get("tracking_number")),
        sum(1 for m in merged if not m.get("tracking_number")),
    )
    return merged
