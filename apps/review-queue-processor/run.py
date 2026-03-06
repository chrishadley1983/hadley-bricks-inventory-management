"""Review Queue Processor — identifies LEGO set numbers and creates purchase/inventory records.

Runs daily via Windows Task Scheduler. For Vinted items, fetches listing photos
via Playwright and uses Claude Vision for high-confidence identification.
Falls back to text-only Claude CLI for items without images.
Creates purchase + inventory records directly in Supabase.
"""

import logging
import sys

from src.config import DRY_RUN
from src.supabase_client import fetch_skipped_items, dismiss_item
from src.identifier import identify_set_numbers
from src.local_approve import approve_item
from src.emailer import send_report
from src.report_builder import build_report

log = logging.getLogger(__name__)


def _try_fetch_images(item: dict) -> list[str]:
    """Attempt to fetch Vinted listing images for an item.

    Returns list of image paths, or empty list on failure/non-Vinted items.
    """
    source = (item.get("source") or "").lower()
    seller = item.get("seller_username", "")

    if source != "vinted" or not seller:
        return []

    try:
        from src.vinted_images import fetch_listing_images

        return fetch_listing_images(
            seller_username=seller,
            item_name=item.get("item_name", ""),
        )
    except ImportError:
        log.warning("Playwright not installed — skipping image fetch")
        return []
    except Exception as e:
        log.warning("Image fetch failed for %s: %s", seller, e)
        return []


def main() -> None:
    log.info("=== Review Queue Processor starting (DRY_RUN=%s) ===", DRY_RUN)

    # 1. Fetch skipped items
    items = fetch_skipped_items()
    if not items:
        log.info("Queue is empty — nothing to process.")
        return

    log.info("Processing %d items...", len(items))

    approved_report: list[dict] = []
    dismissed_report: list[dict] = []
    skipped_report: list[dict] = []
    errors_report: list[dict] = []

    for item in items:
        item_id = item["id"]
        item_name = item.get("item_name", "Unknown")
        log.info("--- Processing: %s (id=%s) ---", item_name, item_id)

        # 2. Fetch Vinted listing images (if applicable)
        image_paths = _try_fetch_images(item)
        if image_paths:
            log.info("Fetched %d images for %s", len(image_paths), item_name)

        # 3. Identify set numbers (vision + text fallback)
        result = identify_set_numbers(item, image_paths=image_paths or None)

        if result is None:
            errors_report.append({
                "item_name": item_name,
                "error": "Identification failed (Claude CLI/Vision timeout or error)",
            })
            continue

        is_lego = result.get("is_lego", False)
        confidence = result.get("confidence", "low")
        reasoning = result.get("reasoning", "")
        identified_items = result.get("items", [])
        used_vision = bool(image_paths)

        # 4a. Not LEGO → dismiss
        if not is_lego:
            log.info("Not LEGO — dismissing: %s (%s)", item_name, reasoning)
            if not DRY_RUN:
                dismiss_item(item_id)
            dismissed_report.append({
                "item_name": item_name,
                "reason": reasoning,
            })
            continue

        # 4b. Low confidence → leave for manual review
        if confidence == "low":
            log.info("Low confidence — skipping: %s (%s)", item_name, reasoning)
            skipped_report.append({
                "item_name": item_name,
                "reason": f"Low confidence: {reasoning}",
            })
            continue

        # 4c. High/medium confidence → approve
        if not identified_items:
            errors_report.append({
                "item_name": item_name,
                "error": "is_lego=true but no items returned",
            })
            continue

        set_numbers = ", ".join(i.get("set_number", "?") for i in identified_items)
        method = "vision" if used_vision else "text-only"
        log.info(
            "Identified %s → %s (confidence=%s, method=%s)",
            item_name,
            set_numbers,
            confidence,
            method,
        )

        if DRY_RUN:
            log.info(
                "[DRY RUN] Would approve %s with sets: %s",
                item_id,
                set_numbers,
            )
            approved_report.append({
                "item_name": item_name,
                "set_numbers": set_numbers,
                "cost": item.get("cost", "?"),
                "source": item.get("source", "?"),
            })
            continue

        # 5. Create purchase + inventory records locally
        approve_result = approve_item(item, identified_items)
        if approve_result:
            approved_report.append({
                "item_name": item_name,
                "set_numbers": set_numbers,
                "cost": item.get("cost", "?"),
                "source": item.get("source", "?"),
            })
        else:
            errors_report.append({
                "item_name": item_name,
                "error": f"Local approval failed for sets: {set_numbers}",
            })

    # 6. Send summary email
    total = (
        len(approved_report)
        + len(dismissed_report)
        + len(skipped_report)
        + len(errors_report)
    )
    log.info(
        "Done: %d approved, %d dismissed, %d manual, %d errors",
        len(approved_report),
        len(dismissed_report),
        len(skipped_report),
        len(errors_report),
    )

    dry_prefix = "[DRY RUN] " if DRY_RUN else ""
    subject = (
        f"{dry_prefix}Review Queue: {len(approved_report)} approved, "
        f"{len(dismissed_report)} dismissed ({total} total)"
    )

    html = build_report(
        approved_report, dismissed_report, skipped_report, errors_report
    )

    try:
        send_report(subject, html)
    except Exception as e:
        log.error("Failed to send email report: %s", e)


if __name__ == "__main__":
    try:
        main()
    except Exception:
        log.exception("Review Queue Processor failed")
        sys.exit(1)
