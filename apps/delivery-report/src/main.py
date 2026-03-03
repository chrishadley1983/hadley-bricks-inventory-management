"""
Hadley Bricks — Amazon Delivery Performance Report Pipeline

Cloud Run Job entry point. Orchestrates the 10-step pipeline:
1. Log job start
2. Load cache from Supabase
3. Get cancelled order IDs
4. Get active orders from Supabase
5. Scrape tracking from Click & Drop
6. Match orders with tracking data
7. Look up Royal Mail tracking for new/recheck orders
8. Build report (HTML + PDF)
9. Send email and upload to GCS
10. Update cache, validate, log completion
"""

import logging
import sys
import traceback
from datetime import date, datetime

log = logging.getLogger("delivery-report")


def main() -> None:
    # Import config first to configure logging
    from src import config

    log.info("=== Delivery Report Pipeline Starting ===")
    log.info("DRY_RUN=%s", config.DRY_RUN)

    job_id = None

    try:
        # ── Step 1: Log job start ──────────────────────────────────────
        from src.data.supabase_client import log_job_start

        log.info("Step 1/10: Logging job start")
        job_id = log_job_start()

        # ── Step 2: Load cache ─────────────────────────────────────────
        from src.data.supabase_client import get_cached_orders

        log.info("Step 2/10: Loading cache from Supabase")
        cache = get_cached_orders()
        log.info("Cache has %d entries", len(cache))

        # ── Step 3: Get cancelled orders ───────────────────────────────
        from src.data.supabase_client import get_cancelled_order_ids

        log.info("Step 3/10: Getting cancelled order IDs")
        cancelled_ids = get_cancelled_order_ids()
        log.info("Found %d cancelled orders", len(cancelled_ids))

        # ── Step 4: Get active orders ──────────────────────────────────
        from src.data.supabase_client import get_active_orders

        log.info("Step 4/10: Getting active orders from Supabase")
        supabase_orders = get_active_orders()
        log.info("Got %d active orders", len(supabase_orders))

        # ── Step 5: Scrape Click & Drop ────────────────────────────────
        from src.scrapers.click_and_drop import scrape_tracking

        log.info("Step 5/10: Scraping Click & Drop for tracking numbers")
        cd_tracking = scrape_tracking()
        log.info("Got tracking for %d orders from Click & Drop", len(cd_tracking))

        # ── Step 6: Match datasets ─────────────────────────────────────
        from src.data.matcher import match_orders

        log.info("Step 6/10: Matching orders with tracking data")
        merged = match_orders(supabase_orders, cd_tracking, cancelled_ids, cache)
        log.info("Merged into %d orders", len(merged))

        # ── Step 7: Royal Mail lookups ─────────────────────────────────
        from src.data.cache import categorise_orders
        from src.scrapers.royal_mail_tracking import lookup_tracking, map_results_to_orders

        log.info("Step 7/10: Looking up Royal Mail tracking")
        buckets = categorise_orders(merged, cache)

        orders_to_lookup = buckets["needs_recheck"] + buckets["new_orders"]
        tracking_numbers = [
            o["tracking_number"] for o in orders_to_lookup if o.get("tracking_number")
        ]

        rm_results_raw = {}
        if tracking_numbers:
            log.info("Looking up %d tracking numbers on Royal Mail", len(tracking_numbers))
            rm_results_raw = lookup_tracking(tracking_numbers)
        else:
            log.info("No new tracking numbers to look up")

        rm_results = map_results_to_orders(rm_results_raw, orders_to_lookup)

        # ── Step 8: Build report ───────────────────────────────────────
        from src.data.cache import build_cache_rows
        from src.report.builder import build_email_body, build_full_report
        from src.report.otdr import (
            build_all_orders_list,
            calculate_otdr,
            compute_summary_stats,
            get_late_orders_with_dropoff,
            project_90_percent,
        )
        from src.report.pdf import html_to_pdf

        log.info("Step 8/10: Building report")

        # Build final order list with all data merged
        cache_rows = build_cache_rows(merged, rm_results, cache, cancelled_ids)
        # Use cache_rows as the source for report data
        final_orders = cache_rows

        today = date.today()
        date_str = today.strftime("%d %b %Y")

        stats = compute_summary_stats(final_orders)
        otdr_now = calculate_otdr(final_orders, today, offset_days=0)
        otdr_next = calculate_otdr(final_orders, today, offset_days=1)
        otdr_90 = project_90_percent(final_orders, today)
        late_orders = get_late_orders_with_dropoff(final_orders, today)
        all_orders_list = build_all_orders_list(final_orders)

        email_html = build_email_body(
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
        )

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
        )

        pdf_bytes = html_to_pdf(full_html)
        log.info("Report built: email HTML %d bytes, PDF %d bytes", len(email_html), len(pdf_bytes))

        # ── Step 9: Send email and upload to GCS ───────────────────────
        log.info("Step 9/10: Sending email and uploading to GCS")

        if config.DRY_RUN:
            log.info("DRY_RUN: Skipping email and GCS upload")
        else:
            from src.notifications.emailer import send_report
            from src.storage.gcs import upload_report

            on_time_pct = round(
                (stats["on_time_count"] / stats["on_time_total"] * 100) if stats["on_time_total"] > 0 else 0, 1
            )
            subject = (
                f"Amazon Delivery Report \u2014 {date_str} "
                f"({on_time_pct:.1f}% On-Time, OTDR {otdr_now['pct']:.1f}%)"
            )
            pdf_filename = f"Amazon_Delivery_Report_{today.strftime('%Y-%m-%d')}.pdf"

            send_report(subject, email_html, pdf_bytes, pdf_filename)

            try:
                gcs_uris = upload_report(full_html, pdf_bytes, today.strftime("%Y-%m-%d"))
                log.info("Uploaded to GCS: %s", gcs_uris)
            except Exception as e:
                log.warning("GCS upload failed (non-fatal): %s", e)

        # ── Step 10: Update cache, validate, log completion ────────────
        from src.data.supabase_client import (
            delete_cache_entries,
            log_job_complete,
            prune_old_cache,
            upsert_cache,
            validate_cache_against_supabase,
        )

        log.info("Step 10/10: Updating cache and validating")

        upsert_cache(cache_rows)
        prune_old_cache(days=35)

        # Validate cache against Supabase
        all_cache_ids = [row["platform_order_id"] for row in cache_rows]
        phantoms = validate_cache_against_supabase(all_cache_ids)
        if phantoms:
            log.warning("Removing %d phantom entries: %s", len(phantoms), phantoms)
            delete_cache_entries(phantoms)

        log_job_complete(
            job_id,
            items_processed=len(merged),
            result_summary={
                "total_orders": stats["total_orders"],
                "delivered": stats["delivered"],
                "in_transit": stats["in_transit"],
                "otdr_now": otdr_now["pct"],
                "cd_tracking_matches": len(cd_tracking),
                "rm_lookups": len(tracking_numbers),
                "phantoms_removed": len(phantoms),
            },
        )

        log.info("=== Pipeline complete ===")

    except Exception as e:
        error_msg = f"{type(e).__name__}: {e}"
        log.error("Pipeline failed: %s", error_msg)
        log.error(traceback.format_exc())

        # Log failure to Supabase
        if job_id:
            try:
                from src.data.supabase_client import log_job_failed

                log_job_failed(job_id, error_msg)
            except Exception:
                log.error("Failed to log job failure to Supabase")

        # Send failure alert email
        try:
            from src.notifications.emailer import send_failure_alert

            send_failure_alert(error_msg)
        except Exception:
            log.error("Failed to send failure alert email")

        sys.exit(1)


if __name__ == "__main__":
    main()
