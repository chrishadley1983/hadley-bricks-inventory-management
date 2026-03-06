"""
Amazon OTDR (On-Time Delivery Rate) calculation.

Amazon's OTDR uses a ~7-day reporting lag and 15-day rolling window (inclusive).
On any given day, Amazon shows OTDR for a window ending ~7 days ago.
Window = (today - 7 - 14) to (today - 7) inclusive = 15 days.
"""

import logging
from datetime import date, datetime, timedelta

log = logging.getLogger(__name__)

AMAZON_LAG_DAYS = 7
WINDOW_DAYS = 14  # 15 days inclusive = start to start+14


def calculate_otdr(
    orders: list[dict],
    reference_date: date | None = None,
    offset_days: int = 0,
) -> dict:
    """
    Calculate OTDR for a given reference date with optional day offset.

    Args:
        orders: List of order dicts with expected_delivery, rm_status, rm_delivery_date
        reference_date: The "today" date (defaults to actual today)
        offset_days: Shift the window forward by this many days

    Returns:
        {pct, on_time, total, late, window_start, window_end, window_str}
    """
    if reference_date is None:
        reference_date = date.today()

    effective_date = reference_date + timedelta(days=offset_days)
    window_end = effective_date - timedelta(days=AMAZON_LAG_DAYS)
    window_start = window_end - timedelta(days=WINDOW_DAYS)

    in_window = []
    for order in orders:
        exp = _parse_date(order.get("expected_delivery"))
        if exp and window_start <= exp <= window_end:
            in_window.append(order)

    on_time = 0
    late = 0
    for order in in_window:
        exp = _parse_date(order.get("expected_delivery"))
        status = (order.get("rm_status") or "").lower()

        if "delivered" in status:
            delivery = _parse_date(order.get("rm_delivery_date"))
            if delivery and exp:
                if delivery <= exp:
                    on_time += 1
                else:
                    late += 1
            else:
                # Delivered but no date — assume on time (conservative)
                on_time += 1
        # Non-delivered orders in the window are not counted yet by Amazon

    total = on_time + late
    pct = round((on_time / total * 100) if total > 0 else 0, 1)

    window_str = f"{window_start.strftime('%d %b')} \u2013 {window_end.strftime('%d %b %Y')}"

    return {
        "pct": pct,
        "on_time": on_time,
        "total": total,
        "late": late,
        "window_start": window_start,
        "window_end": window_end,
        "window_str": window_str,
    }


def project_90_percent(orders: list[dict], reference_date: date | None = None, max_days: int = 60) -> dict:
    """
    Project forward day by day to find when OTDR first hits 90%.

    As late orders age out of the 15-day window, OTDR improves.

    Returns:
        {date, pct, window_str, calendar_date_str}
        calendar_date is window_end + LAG_DAYS (when Amazon dashboard shows it)
    """
    if reference_date is None:
        reference_date = date.today()

    for day_offset in range(0, max_days + 1):
        result = calculate_otdr(orders, reference_date, offset_days=day_offset)
        if result["pct"] >= 90.0 and result["total"] > 0:
            calendar_date = result["window_end"] + timedelta(days=AMAZON_LAG_DAYS)
            return {
                "date": calendar_date,
                "pct": result["pct"],
                "window_str": result["window_str"],
                "calendar_date_str": f"~{calendar_date.strftime('%a %d %b')}",
            }

    # If 90% not reachable, return the best we found
    best = None
    for day_offset in range(0, max_days + 1):
        result = calculate_otdr(orders, reference_date, offset_days=day_offset)
        if best is None or result["pct"] > best["pct"]:
            best = result
            best["_offset"] = day_offset

    if best:
        calendar_date = best["window_end"] + timedelta(days=AMAZON_LAG_DAYS)
        return {
            "date": calendar_date,
            "pct": best["pct"],
            "window_str": best["window_str"],
            "calendar_date_str": f"~{calendar_date.strftime('%a %d %b')}",
        }

    return {
        "date": reference_date,
        "pct": 0.0,
        "window_str": "N/A",
        "calendar_date_str": "N/A",
    }


def get_late_orders_with_dropoff(orders: list[dict], reference_date: date | None = None) -> list[dict]:
    """
    Get late orders in the current OTDR window with their drop-off dates.

    drop_off_date = expected_delivery + 14 days + 7 days (lag)
    """
    if reference_date is None:
        reference_date = date.today()

    window_end = reference_date - timedelta(days=AMAZON_LAG_DAYS)
    window_start = window_end - timedelta(days=WINDOW_DAYS)

    late_orders = []
    for order in orders:
        exp = _parse_date(order.get("expected_delivery"))
        if not exp or not (window_start <= exp <= window_end):
            continue

        status = (order.get("rm_status") or "").lower()
        if "delivered" not in status:
            continue

        delivery = _parse_date(order.get("rm_delivery_date"))
        if not delivery or delivery <= exp:
            continue

        # This order is late
        drop_off = exp + timedelta(days=WINDOW_DAYS) + timedelta(days=AMAZON_LAG_DAYS)

        late_orders.append({
            "order_date": _format_date(order.get("order_date")),
            "item": order.get("item_name", "Unknown"),
            "order_no": order.get("platform_order_id", ""),
            "expected": _format_date(exp),
            "actual": _format_date(delivery),
            "drop_off": _format_date(drop_off),
        })

    return late_orders


def compute_summary_stats(orders: list[dict]) -> dict:
    """Compute top-level summary stats for the report."""
    total = len(orders)
    delivered = 0
    in_transit = 0
    on_time = 0

    for order in orders:
        status = (order.get("rm_status") or "").lower()
        if "delivered" in status:
            delivered += 1
            exp = _parse_date(order.get("expected_delivery"))
            delivery = _parse_date(order.get("rm_delivery_date"))
            if exp and delivery and delivery <= exp:
                on_time += 1
            elif "assumed on time" in status:
                on_time += 1
        elif status in ("not dispatched yet", "not checked", "unknown"):
            in_transit += 1
        else:
            in_transit += 1

    return {
        "total_orders": total,
        "delivered": delivered,
        "in_transit": total - delivered,
        "on_time_count": on_time,
        "on_time_total": delivered,
    }


def build_all_orders_list(orders: list[dict]) -> list[dict]:
    """Build the all-orders list for the full report."""
    result = []
    for order in sorted(orders, key=lambda o: o.get("order_date", ""), reverse=True):
        exp = _parse_date(order.get("expected_delivery"))
        delivery = _parse_date(order.get("rm_delivery_date"))
        status = order.get("rm_status", "Unknown")

        # Determine on-time status
        status_lower = status.lower()
        if "delivered" in status_lower:
            if exp and delivery:
                on_time_status = "On time" if delivery <= exp else "Late"
            else:
                on_time_status = "Delivered"
        elif status_lower in ("not dispatched yet",):
            on_time_status = "Not dispatched"
        elif status_lower in ("not checked",):
            on_time_status = "Not checked"
        elif "expired" in status_lower:
            on_time_status = "Expired"
        elif "transit" in status_lower or "ready" in status_lower:
            on_time_status = "In transit"
        elif status_lower == "unknown":
            on_time_status = "Unknown"
        else:
            on_time_status = status

        result.append({
            "order_date": _format_date(order.get("order_date")),
            "item": order.get("item_name", "Unknown"),
            "order_no": order.get("platform_order_id", ""),
            "tracking": order.get("tracking_number", ""),
            "expected": _format_date(exp) if exp else "",
            "actual": _format_date(delivery) if delivery else "",
            "status": on_time_status,
        })

    return result


def compute_e2e_stats(orders: list[dict]) -> dict:
    """
    Compute end-to-end delivery timeline stats.

    Returns avg days for order→expected, order→actual, and the delta.
    Only includes delivered orders with both expected_delivery and rm_delivery_date.
    """
    samples = []
    order_dates: list[date] = []
    for order in orders:
        status = (order.get("rm_status") or "").lower()
        if "delivered" not in status:
            continue

        order_dt = _parse_date(order.get("order_date"))
        expected = _parse_date(order.get("expected_delivery"))
        actual = _parse_date(order.get("rm_delivery_date"))

        if not (order_dt and expected and actual):
            continue

        expected_days = (expected - order_dt).days
        actual_days = (actual - order_dt).days
        delta_days = actual_days - expected_days

        samples.append({
            "expected_days": expected_days,
            "actual_days": actual_days,
            "delta_days": delta_days,
        })
        order_dates.append(order_dt)

    if not samples:
        return {
            "avg_expected_days": 0.0,
            "avg_actual_days": 0.0,
            "avg_delta_days": 0.0,
            "sample_size": 0,
            "period_str": "N/A",
        }

    n = len(samples)
    earliest = min(order_dates)
    latest = max(order_dates)
    period_str = f"{earliest.strftime('%d %b')} \u2013 {latest.strftime('%d %b %Y')}"

    return {
        "avg_expected_days": round(sum(s["expected_days"] for s in samples) / n, 1),
        "avg_actual_days": round(sum(s["actual_days"] for s in samples) / n, 1),
        "avg_delta_days": round(sum(s["delta_days"] for s in samples) / n, 1),
        "sample_size": n,
        "period_str": period_str,
    }


def _parse_date(val) -> date | None:
    if val is None:
        return None
    if isinstance(val, date):
        return val
    s = str(val)[:10]
    for fmt in ("%Y-%m-%d", "%d-%m-%Y", "%d/%m/%Y"):
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    return None


def _format_date(val) -> str:
    d = _parse_date(val) if not isinstance(val, date) else val
    if d is None:
        return ""
    return d.strftime("%d %b %Y")
