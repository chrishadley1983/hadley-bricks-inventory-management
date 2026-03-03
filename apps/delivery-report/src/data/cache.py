"""Cache categorisation — determines which orders need RM lookups."""

import logging
from datetime import date, datetime, timedelta

log = logging.getLogger(__name__)


def _map_cd_status(cd_status: str) -> str | None:
    """Map Click & Drop status to an RM-style status when RM is unavailable.

    Returns None if the cd_status doesn't map to anything meaningful.
    """
    if not cd_status:
        return None
    t = cd_status.lower().strip()
    if "delivered" in t:
        return "Delivered (CD)"
    if any(kw in t for kw in ("transit", "despatched", "dispatched", "got it", "we have")):
        return "In Transit (CD)"
    if "ready" in t:
        return "In Transit (CD)"
    # Any other non-empty status — use it directly
    if t:
        return f"{cd_status.strip()} (CD)"
    return None


def categorise_orders(
    merged_orders: list[dict],
    cache: dict[str, dict],
) -> dict[str, list[dict]]:
    """
    Categorise orders into lookup buckets:
    - cached_delivered: delivered in cache, skip RM lookup
    - needs_recheck: in cache but not delivered, re-check RM
    - new_orders: not in cache, need RM lookup
    - no_tracking: no tracking number available, skip RM lookup

    Each dict in merged_orders must have: platform_order_id, tracking_number
    """
    result = {
        "cached_delivered": [],
        "needs_recheck": [],
        "new_orders": [],
        "no_tracking": [],
    }

    for order in merged_orders:
        oid = order["platform_order_id"]
        tracking = order.get("tracking_number")
        cached = cache.get(oid)

        if not tracking:
            result["no_tracking"].append(order)
        elif cached and _is_delivered(cached.get("rm_status", "")):
            result["cached_delivered"].append(order)
        elif cached and cached.get("needs_recheck"):
            result["needs_recheck"].append(order)
        elif cached:
            # In cache, has tracking, not marked for recheck — treat as delivered
            result["cached_delivered"].append(order)
        else:
            result["new_orders"].append(order)

    log.info(
        "Categorised: %d delivered (cached), %d recheck, %d new, %d no-tracking",
        len(result["cached_delivered"]),
        len(result["needs_recheck"]),
        len(result["new_orders"]),
        len(result["no_tracking"]),
    )
    return result


def _is_delivered(status: str) -> bool:
    return "delivered" in status.lower()


def prune_stale_entries(cache: dict[str, dict], max_age_days: int = 35) -> dict[str, dict]:
    """Remove cache entries older than max_age_days."""
    cutoff = date.today() - timedelta(days=max_age_days)
    pruned = {}
    removed = 0

    for oid, entry in cache.items():
        order_date_str = entry.get("order_date")
        if order_date_str:
            try:
                order_date = datetime.strptime(str(order_date_str)[:10], "%Y-%m-%d").date()
                if order_date < cutoff:
                    removed += 1
                    continue
            except ValueError:
                pass
        pruned[oid] = entry

    if removed:
        log.info("Pruned %d cache entries older than %d days", removed, max_age_days)
    return pruned


def build_cache_rows(
    merged_orders: list[dict],
    rm_results: dict[str, dict],
    cache: dict[str, dict],
    cancelled_ids: set[str],
) -> list[dict]:
    """
    Build cache rows for upserting to Supabase.
    Merges existing cache data with fresh RM lookup results.
    Excludes cancelled orders.
    """
    rows = []
    today = date.today().isoformat()

    for order in merged_orders:
        oid = order["platform_order_id"]
        if oid in cancelled_ids:
            continue

        cached = cache.get(oid, {})
        rm = rm_results.get(oid, {})

        # Use RM result if available, otherwise keep cached value
        rm_status = rm.get("rm_status") or cached.get("rm_status") or "Not checked"
        rm_delivery_date = rm.get("rm_delivery_date") or cached.get("rm_delivery_date")
        tracking = order.get("tracking_number") or cached.get("tracking_number")

        # Fallback: when RM returns "Unknown" (e.g. bot-blocked by Akamai),
        # use Click & Drop status if available
        if rm_status == "Unknown" and order.get("cd_status"):
            mapped = _map_cd_status(order["cd_status"])
            if mapped:
                log.debug("RM Unknown for %s, using CD fallback: %s → %s", oid, order["cd_status"], mapped)
                rm_status = mapped

        if not tracking:
            rm_status = "Not dispatched yet" if _is_recent(order) else "Not checked"

        needs_recheck = not _is_delivered(rm_status)

        rows.append(
            {
                "platform_order_id": oid,
                "order_date": order.get("order_date"),
                "dispatch_by": order.get("dispatch_by"),
                "item_name": order.get("item_name") or cached.get("item_name") or "Unknown",
                "expected_delivery": order.get("expected_delivery"),
                "tracking_number": tracking,
                "rm_status": rm_status,
                "rm_delivery_date": rm_delivery_date,
                "needs_recheck": needs_recheck,
                "last_checked": today if rm else cached.get("last_checked"),
                "updated_at": datetime.now().isoformat(),
            }
        )

    return rows


def _is_recent(order: dict, days: int = 2) -> bool:
    """Check if the order's dispatch_by is within the last N days."""
    dispatch_by = order.get("dispatch_by")
    if not dispatch_by:
        return True
    try:
        db = datetime.strptime(str(dispatch_by)[:10], "%Y-%m-%d").date()
        return db >= date.today() - timedelta(days=days)
    except ValueError:
        return True
