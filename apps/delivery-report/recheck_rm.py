"""Re-check Royal Mail tracking for all orders marked needs_recheck in cache.

Uses your running Chrome instance via CDP to avoid Akamai blocking.
Before running: close Chrome, then relaunch with remote debugging:
  chrome.exe --remote-debugging-port=9222
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
os.environ.setdefault("DRY_RUN", "true")
os.environ.setdefault("CLICK_DROP_EMAIL", "unused")
os.environ.setdefault("CLICK_DROP_PASSWORD", "unused")
os.environ.setdefault("SMTP_SENDER", "unused")
os.environ.setdefault("SMTP_APP_PASSWORD", "unused")
os.environ.setdefault("SMTP_RECIPIENT", "unused")

import logging
import re
import time
from datetime import date, datetime

from playwright.sync_api import sync_playwright

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
log = logging.getLogger("recheck")

from src.data.supabase_client import get_client
from src.report.builder import build_full_report
from src.report.otdr import (
    build_all_orders_list,
    calculate_otdr,
    compute_e2e_stats,
    compute_summary_stats,
    get_late_orders_with_dropoff,
    project_90_percent,
)

RM_TRACKING_URL = "https://www.royalmail.com/track-your-item#/tracking-results/{tracking}"
DATE_PATTERN = re.compile(r"(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})")
KNOWN_STATUSES = {"delivered", "in transit", "ready for delivery"}
BATCH_SIZE = 20
BATCH_PAUSE_SECS = 10
PAGE_WAIT_SECS = 5


def extract_status(page, tracking: str) -> dict:
    """Extract tracking status — same logic as the fixed scraper."""
    text = page.inner_text("body").lower()

    if len(text) < 100 or "access denied" in text:
        time.sleep(3)
        text = page.inner_text("body").lower()
        if len(text) < 100:
            return {"rm_status": "Unknown", "rm_delivery_date": None}

    if "unable to confirm the status" in text or "tracking information not available" in text:
        return {"rm_status": "RM data expired", "rm_delivery_date": None}

    # Try heading first
    for selector in ["h1", "h2", "h3", "[class*='status']"]:
        try:
            elements = page.locator(selector)
            for i in range(min(elements.count(), 5)):
                h = elements.nth(i).inner_text().strip().lower()
                if h in KNOWN_STATUSES:
                    if h == "delivered":
                        return {"rm_status": "Delivered", "rm_delivery_date": extract_date(page)}
                    if h == "in transit":
                        return {"rm_status": "In transit", "rm_delivery_date": None}
                    if h == "ready for delivery":
                        return {"rm_status": "Ready for Delivery", "rm_delivery_date": None}
        except Exception:
            continue

    # Fallback: body text — non-delivered first
    if "in transit" in text:
        return {"rm_status": "In transit", "rm_delivery_date": None}
    if "ready for delivery" in text:
        return {"rm_status": "Ready for Delivery", "rm_delivery_date": None}
    if "we have your item" in text:
        return {"rm_status": "We have your item", "rm_delivery_date": None}
    if "item dispatched" in text:
        return {"rm_status": "Item dispatched", "rm_delivery_date": None}
    if "delivered" in text:
        return {"rm_status": "Delivered", "rm_delivery_date": extract_date(page)}

    return {"rm_status": "Unknown", "rm_delivery_date": None}


def extract_date(page) -> str | None:
    text = page.inner_text("body")
    for match in DATE_PATTERN.findall(text):
        for sep in ["-", "/"]:
            if sep in match:
                parts = match.split(sep)
                if len(parts) == 3:
                    try:
                        day, month, year = int(parts[0]), int(parts[1]), int(parts[2])
                        if year < 100:
                            year += 2000
                        if 1 <= day <= 31 and 1 <= month <= 12:
                            return f"{year:04d}-{month:02d}-{day:02d}"
                    except ValueError:
                        continue
    return None


def lookup_via_cdp(tracking_numbers: list[str]) -> dict[str, dict]:
    """Look up tracking numbers using your running Chrome via CDP."""
    results = {}
    with sync_playwright() as p:
        browser = p.chromium.connect_over_cdp("http://127.0.0.1:9222")
        context = browser.contexts[0]
        page = context.new_page()

        try:
            for i, tracking in enumerate(tracking_numbers):
                if i > 0 and i % BATCH_SIZE == 0:
                    log.info("Batch pause %ds (processed %d/%d)", BATCH_PAUSE_SECS, i, len(tracking_numbers))
                    time.sleep(BATCH_PAUSE_SECS)

                url = RM_TRACKING_URL.format(tracking=tracking)
                try:
                    page.goto(url, wait_until="domcontentloaded", timeout=20000)
                    time.sleep(PAGE_WAIT_SECS)
                    result = extract_status(page, tracking)
                    results[tracking] = result
                    log.info("  [%d/%d] %s → %s %s", i + 1, len(tracking_numbers),
                             tracking, result["rm_status"], result.get("rm_delivery_date") or "")
                except Exception as e:
                    log.warning("  [%d/%d] %s → ERROR: %s", i + 1, len(tracking_numbers), tracking, e)
                    results[tracking] = {"rm_status": "Lookup failed", "rm_delivery_date": None}
        finally:
            page.close()

    return results


def main():
    client = get_client()

    # 1. Get all orders needing recheck
    result = client.table("delivery_tracking_cache").select("*").eq("needs_recheck", True).execute()
    orders = result.data or []
    log.info("Found %d orders needing re-check", len(orders))

    # 2. Collect tracking numbers
    to_lookup = [o for o in orders if o.get("tracking_number")]
    tracking_numbers = [o["tracking_number"] for o in to_lookup]
    log.info("Looking up %d tracking numbers on Royal Mail via CDP", len(tracking_numbers))

    # 3. Do RM lookups via your running Chrome
    rm_results = lookup_via_cdp(tracking_numbers) if tracking_numbers else {}

    # 4. Update cache with results
    updated = 0
    for order in to_lookup:
        tn = order["tracking_number"]
        rm = rm_results.get(tn, {})
        rm_status = rm.get("rm_status", "Unknown")
        rm_delivery_date = rm.get("rm_delivery_date")
        is_delivered = "delivered" in rm_status.lower()

        client.table("delivery_tracking_cache").update({
            "rm_status": rm_status,
            "rm_delivery_date": rm_delivery_date,
            "needs_recheck": not is_delivered,
            "last_checked": date.today().isoformat(),
            "updated_at": datetime.now().isoformat(),
        }).eq("platform_order_id", order["platform_order_id"]).execute()
        updated += 1

    log.info("Updated %d cache entries", updated)

    # 5. Summary
    statuses = {}
    for tn, rm in rm_results.items():
        s = rm.get("rm_status", "Unknown")
        statuses[s] = statuses.get(s, 0) + 1
    log.info("Status breakdown: %s", statuses)

    # 6. Rebuild report with fresh data
    log.info("Rebuilding report...")
    all_cache = client.table("delivery_tracking_cache").select("*").execute()
    final_orders = all_cache.data or []

    today = date.today()
    date_str = today.strftime("%d %b %Y")

    stats = compute_summary_stats(final_orders)
    otdr_now = calculate_otdr(final_orders, today, offset_days=0)
    otdr_next = calculate_otdr(final_orders, today, offset_days=1)
    otdr_90 = project_90_percent(final_orders, today)
    late_orders = get_late_orders_with_dropoff(final_orders, today)
    all_orders_list = build_all_orders_list(final_orders)
    e2e_stats = compute_e2e_stats(final_orders)

    full_html = build_full_report(
        date_str=date_str,
        total_orders=stats["total_orders"],
        delivered=stats["delivered"],
        in_transit=stats["in_transit"],
        on_time_count=stats["on_time_count"],
        on_time_total=stats["on_time_total"],
        otdr_now_pct=otdr_now["pct"],
        otdr_now_on_time=otdr_now["on_time"],
        otdr_now_total=otdr_now["total"],
        otdr_now_window=otdr_now["window_str"],
        otdr_next_pct=otdr_next["pct"],
        otdr_next_on_time=otdr_next["on_time"],
        otdr_next_total=otdr_next["total"],
        otdr_next_window=otdr_next["window_str"],
        otdr_90_date=otdr_90["calendar_date_str"],
        otdr_90_pct=otdr_90["pct"],
        otdr_90_window=otdr_90["window_str"],
        late_orders=late_orders,
        all_orders=all_orders_list,
        e2e_expected_days=e2e_stats["avg_expected_days"],
        e2e_actual_days=e2e_stats["avg_actual_days"],
        e2e_delta_days=e2e_stats["avg_delta_days"],
        e2e_sample_size=e2e_stats["sample_size"],
        e2e_period_str=e2e_stats["period_str"],
    )

    out_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "test_report.html")
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(full_html)

    log.info("Report written to: %s", out_path)
    log.info("E2E Stats: %s", e2e_stats)
    log.info("OTDR now: %.1f%% (%d/%d)", otdr_now["pct"], otdr_now["on_time"], otdr_now["total"])


if __name__ == "__main__":
    main()
