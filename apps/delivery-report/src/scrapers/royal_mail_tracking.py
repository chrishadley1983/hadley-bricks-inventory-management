"""
Royal Mail public tracking scraper — Playwright automation for RM tracking SPA.

Key behaviours:
- Full page reload per tracking number (Angular SPA doesn't re-render on hash change)
- 5s wait for Angular to bootstrap and fetch data
- Cookie consent dismissal on first visit
- Batch with 10s pauses every 20 lookups
- Tracking data expires after ~7 days
"""

import logging
import re
import time

from playwright.sync_api import Page, sync_playwright

log = logging.getLogger(__name__)

RM_TRACKING_URL = "https://www.royalmail.com/track-your-item#/tracking-results/{tracking}"
BATCH_SIZE = 20
BATCH_PAUSE_SECS = 10
PAGE_WAIT_SECS = 5
DATE_PATTERN = re.compile(r"(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})")


def lookup_tracking(tracking_numbers: list[str]) -> dict[str, dict]:
    """
    Look up delivery status for a list of tracking numbers.

    Returns:
        Dict of tracking_number -> {rm_status, rm_delivery_date}
    """
    if not tracking_numbers:
        return {}

    log.info("Looking up %d tracking numbers on Royal Mail", len(tracking_numbers))

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        try:
            context = browser.new_context()
            page = context.new_page()
            results = {}
            cookie_dismissed = False

            for i, tracking in enumerate(tracking_numbers):
                if i > 0 and i % BATCH_SIZE == 0:
                    log.info("Pausing %ds between batches (processed %d/%d)", BATCH_PAUSE_SECS, i, len(tracking_numbers))
                    time.sleep(BATCH_PAUSE_SECS)

                url = RM_TRACKING_URL.format(tracking=tracking)
                try:
                    page.goto(url, wait_until="domcontentloaded", timeout=20000)
                    time.sleep(PAGE_WAIT_SECS)

                    # Dismiss cookie consent on first visit
                    if not cookie_dismissed:
                        _dismiss_cookies(page)
                        cookie_dismissed = True

                    result = _extract_status(page, tracking)
                    results[tracking] = result

                    if result["rm_status"] != "Unknown":
                        log.debug("  %s: %s %s", tracking, result["rm_status"], result.get("rm_delivery_date", ""))

                except Exception as e:
                    log.warning("Error looking up %s: %s", tracking, e)
                    results[tracking] = {"rm_status": "Lookup failed", "rm_delivery_date": None}

            log.info("Completed RM lookups: %d total", len(results))
            return results

        finally:
            browser.close()


def _dismiss_cookies(page: Page) -> None:
    """Dismiss the cookie consent banner if present."""
    try:
        accept_btns = [
            'button:has-text("Accept")',
            'button:has-text("Accept all")',
            '#onetrust-accept-btn-handler',
            '.cookie-accept',
        ]
        for selector in accept_btns:
            btn = page.locator(selector)
            if btn.count() > 0 and btn.first.is_visible():
                btn.first.click()
                log.debug("Dismissed cookie consent")
                time.sleep(1)
                return
    except Exception:
        pass


def _extract_status(page: Page, tracking: str) -> dict:
    """Extract tracking status from the RM tracking page."""
    text = page.inner_text("body").lower()

    # Check for Akamai challenge / blocked page
    if len(text) < 100 or "access denied" in text or "enable javascript" in text:
        log.debug("Short/blocked page text for %s, waiting extra 3s", tracking)
        time.sleep(3)
        text = page.inner_text("body").lower()
        if len(text) < 100:
            return {"rm_status": "Unknown", "rm_delivery_date": None}

    # Check for data expiry
    if "unable to confirm the status" in text or "tracking information not available" in text:
        return {"rm_status": "RM data expired", "rm_delivery_date": None}

    # Try the main status heading first (most reliable)
    heading_status = _extract_status_heading(page)
    if heading_status:
        if heading_status == "delivered":
            return {"rm_status": "Delivered", "rm_delivery_date": _extract_date(page)}
        if heading_status == "in transit":
            return {"rm_status": "In transit", "rm_delivery_date": None}
        if heading_status == "ready for delivery":
            return {"rm_status": "Ready for Delivery", "rm_delivery_date": None}

    # Fallback: body text — check non-delivered statuses FIRST to avoid
    # false positives from "delivered" appearing in page boilerplate
    if "in transit" in text:
        return {"rm_status": "In transit", "rm_delivery_date": None}
    if "ready for delivery" in text:
        return {"rm_status": "Ready for Delivery", "rm_delivery_date": None}
    if "we have your item" in text:
        return {"rm_status": "We have your item", "rm_delivery_date": None}
    if "item dispatched" in text:
        return {"rm_status": "Item dispatched", "rm_delivery_date": None}

    # Check for delivered last (avoids false positives from boilerplate)
    if "delivered" in text:
        delivery_date = _extract_date(page)
        return {"rm_status": "Delivered", "rm_delivery_date": delivery_date}

    return {"rm_status": "Unknown", "rm_delivery_date": None}


KNOWN_STATUSES = {"delivered", "in transit", "ready for delivery"}


def _extract_status_heading(page: Page) -> str | None:
    """Try to extract the main status heading from the RM tracking page.

    The RM Angular SPA renders the status as a prominent heading (h1/h2).
    Returns the normalised status string, or None if not found.
    """
    for selector in ["h1", "h2", "h3", "[class*='status']"]:
        try:
            elements = page.locator(selector)
            for i in range(min(elements.count(), 5)):
                text = elements.nth(i).inner_text().strip().lower()
                if text in KNOWN_STATUSES:
                    return text
        except Exception:
            continue
    return None


def _extract_date(page: Page) -> str | None:
    """Extract delivery date from the page in YYYY-MM-DD format."""
    text = page.inner_text("body")

    # Look for dates near "delivered" text
    matches = DATE_PATTERN.findall(text)
    for match in matches:
        # Try DD-MM-YYYY or DD/MM/YYYY
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


def map_results_to_orders(
    rm_results: dict[str, dict],
    orders: list[dict],
) -> dict[str, dict]:
    """
    Map RM tracking results back to order IDs.

    Args:
        rm_results: tracking_number -> {rm_status, rm_delivery_date}
        orders: list of order dicts with tracking_number and platform_order_id

    Returns:
        Dict of platform_order_id -> {rm_status, rm_delivery_date}
    """
    mapped = {}
    for order in orders:
        tracking = order.get("tracking_number")
        if tracking and tracking in rm_results:
            mapped[order["platform_order_id"]] = rm_results[tracking]
    return mapped
