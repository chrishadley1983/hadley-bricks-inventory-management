"""Local regeneration script — builds report from cached data for testing."""

import os
import sys

# Add project root to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# Set dummy env vars for config module (only Supabase ones are actually used)
os.environ.setdefault("DRY_RUN", "true")
os.environ.setdefault("CLICK_DROP_EMAIL", "unused")
os.environ.setdefault("CLICK_DROP_PASSWORD", "unused")
os.environ.setdefault("SMTP_SENDER", "unused")
os.environ.setdefault("SMTP_APP_PASSWORD", "unused")
os.environ.setdefault("SMTP_RECIPIENT", "unused")

from datetime import date

from src.data.supabase_client import get_cached_orders
from src.report.builder import build_full_report
from src.report.otdr import (
    build_all_orders_list,
    calculate_otdr,
    compute_e2e_stats,
    compute_summary_stats,
    get_late_orders_with_dropoff,
    project_90_percent,
)


def main():
    print("Loading cached orders from Supabase...")
    cache = get_cached_orders()
    orders = list(cache.values())
    print(f"Loaded {len(orders)} orders")

    today = date.today()
    date_str = today.strftime("%d %b %Y")

    stats = compute_summary_stats(orders)
    otdr_now = calculate_otdr(orders, today, offset_days=0)
    otdr_next = calculate_otdr(orders, today, offset_days=1)
    otdr_90 = project_90_percent(orders, today)
    late_orders = get_late_orders_with_dropoff(orders, today)
    all_orders_list = build_all_orders_list(orders)
    e2e_stats = compute_e2e_stats(orders)

    print(f"\nE2E Stats: {e2e_stats}")

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

    print(f"\nReport written to: {out_path}")
    print(f"Open in browser to verify the E2E delivery timeline card.")


if __name__ == "__main__":
    main()
