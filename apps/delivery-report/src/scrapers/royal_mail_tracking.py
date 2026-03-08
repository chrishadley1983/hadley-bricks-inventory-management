"""
Royal Mail tracking — Chrome CDP approach.

Launches Chrome as a child process with --remote-debugging-port and connects
via CDP. This bypasses Akamai because Chrome is NOT launched by Playwright
(no navigator.webdriver flag). Uses hash URL navigation — no form submission
needed, so no hCaptcha.

For local runs: Chrome is launched with a temp user-data-dir, does lookups,
then is killed. User's normal Chrome is unaffected.

For Cloud Run: Falls back to headless Chromium (may be blocked by Akamai,
but the nightly job is supplemented by local backfill runs).
"""

import json
import logging
import os
import re
import socket
import subprocess
import time

log = logging.getLogger(__name__)

CDP_PORT = int(os.environ.get("CHROME_CDP_PORT", "9222"))
CHROME_PATH = os.environ.get(
    "CHROME_PATH",
    os.path.join("C:\\", "Program Files", "Google", "Chrome", "Application", "chrome.exe"),
)
RM_BASE_URL = "https://www.royalmail.com/track-your-item"
RM_TRACKING_URL = "https://www.royalmail.com/track-your-item#/tracking-results/{tracking}"
BATCH_SIZE = 20
BATCH_PAUSE_SECS = 5
LOOKUP_PAUSE_SECS = 2
SPA_WAIT_SECS = 5

DATE_PATTERN_NEAR_DELIVERED = re.compile(
    r"delivered[\s\S]{0,200}?(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})", re.IGNORECASE
)
DATE_PATTERN_ANY = re.compile(r"(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})")
KNOWN_HEADING_STATUSES = {"delivered", "in transit", "ready for delivery"}


def _is_cdp_available(port: int = CDP_PORT) -> bool:
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=2):
            return True
    except (ConnectionRefusedError, OSError):
        return False


def _launch_chrome_cdp(port: int = CDP_PORT) -> subprocess.Popen | None:
    """Launch Chrome as child process with remote debugging."""
    import tempfile
    user_data_dir = os.path.join(tempfile.gettempdir(), "rm-tracking-chrome")

    try:
        proc = subprocess.Popen(
            [
                CHROME_PATH,
                f"--remote-debugging-port={port}",
                f"--user-data-dir={user_data_dir}",
                "--no-first-run",
                "--no-default-browser-check",
                "about:blank",
            ],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    except FileNotFoundError:
        log.warning("Chrome not found at %s", CHROME_PATH)
        return None

    for _ in range(15):
        time.sleep(1)
        if _is_cdp_available(port):
            log.info("Chrome CDP ready on port %d (pid %d)", port, proc.pid)
            return proc

    log.error("Chrome did not start with CDP within timeout")
    try:
        proc.kill()
    except Exception:
        pass
    return None


def _parse_rm_date(date_str: str) -> str | None:
    """Convert DD-MM-YYYY or DD/MM/YYYY to YYYY-MM-DD. Returns None on failure."""
    for sep in ("-", "/"):
        if sep in date_str:
            parts = date_str.split(sep)
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


def _get_visible_text(page) -> str:
    """Extract visible text from page, excluding scripts/styles."""
    return page.evaluate("""() => {
        const body = document.body.cloneNode(true);
        body.querySelectorAll('script, style, noscript').forEach(s => s.remove());
        return body.innerText;
    }""")


def _dismiss_cookies(page) -> None:
    """Dismiss the RM cookie consent banner if present."""
    try:
        for selector in [
            "#onetrust-accept-btn-handler",
            'button:has-text("Accept all")',
            'button:has-text("Accept")',
        ]:
            btn = page.locator(selector)
            if btn.count() > 0 and btn.first.is_visible():
                btn.first.click()
                log.debug("Dismissed cookie consent via %s", selector)
                time.sleep(1)
                return
    except Exception:
        pass


def lookup_tracking(tracking_numbers: list[str]) -> dict[str, dict]:
    """
    Look up delivery status for a list of tracking numbers.

    Uses Chrome CDP (child process) to bypass Akamai. Navigates via hash URLs
    so no form submission / hCaptcha is needed.

    Returns:
        Dict of tracking_number -> {rm_status, rm_delivery_date}
    """
    if not tracking_numbers:
        return {}

    log.info("Looking up %d tracking numbers on Royal Mail", len(tracking_numbers))

    from playwright.sync_api import sync_playwright

    results = {}
    chrome_proc = None

    # Launch Chrome if not already running with CDP
    if not _is_cdp_available():
        chrome_proc = _launch_chrome_cdp()
        if chrome_proc is None:
            log.error("Cannot launch Chrome — RM lookups skipped")
            return {t: {"rm_status": "Unknown", "rm_delivery_date": None} for t in tracking_numbers}

    with sync_playwright() as p:
        try:
            browser = p.chromium.connect_over_cdp(f"http://127.0.0.1:{CDP_PORT}")
            log.info("Connected to Chrome via CDP")
        except Exception as e:
            log.error("CDP connection failed: %s", e)
            if chrome_proc:
                chrome_proc.kill()
            return {t: {"rm_status": "Unknown", "rm_delivery_date": None} for t in tracking_numbers}

        context = browser.contexts[0] if browser.contexts else browser.new_context()
        page = context.new_page()

        try:
            for i, tracking in enumerate(tracking_numbers):
                if i > 0 and i % BATCH_SIZE == 0:
                    log.info("Pausing %ds between batches (%d/%d)",
                             BATCH_PAUSE_SECS, i, len(tracking_numbers))
                    time.sleep(BATCH_PAUSE_SECS)

                try:
                    # Full SPA reset: about:blank → base URL → hash URL.
                    # - about:blank clears Angular state (prevents stale renders)
                    # - base URL bootstraps Angular fresh
                    # - hash URL triggers results fetch
                    page.goto("about:blank", wait_until="domcontentloaded", timeout=5000)
                    time.sleep(0.5)
                    page.goto(RM_BASE_URL, wait_until="domcontentloaded", timeout=30000)
                    time.sleep(2)
                    if i == 0:
                        _dismiss_cookies(page)

                    # Navigate via hash URL — no form, no hCaptcha
                    url = RM_TRACKING_URL.format(tracking=tracking)
                    page.goto(url, wait_until="domcontentloaded", timeout=30000)
                    time.sleep(SPA_WAIT_SECS)

                    # Get visible text (excluding scripts)
                    visible_text = _get_visible_text(page)

                    # Retry once if SPA didn't render results (shows empty form)
                    if "track another item" not in visible_text.lower() and len(visible_text) > 500:
                        log.debug("SPA didn't render for %s, retrying...", tracking)
                        page.goto("about:blank", wait_until="domcontentloaded", timeout=5000)
                        time.sleep(0.5)
                        page.goto(RM_BASE_URL, wait_until="domcontentloaded", timeout=30000)
                        time.sleep(2)
                        page.goto(url, wait_until="domcontentloaded", timeout=30000)
                        time.sleep(SPA_WAIT_SECS + 2)
                        visible_text = _get_visible_text(page)

                    # Check for Akamai block
                    if len(visible_text) < 100 or "access denied" in visible_text.lower():
                        log.warning("Blocked by Akamai for %s", tracking)
                        results[tracking] = {"rm_status": "Unknown", "rm_delivery_date": None}
                        continue

                    # Parse status — headings first (most reliable)
                    status = None
                    for sel in ["h1", "h2", "h3"]:
                        elements = page.locator(sel)
                        count = elements.count()
                        for j in range(min(count, 5)):
                            heading = elements.nth(j).inner_text().strip().lower()
                            if heading in KNOWN_HEADING_STATUSES:
                                status = heading.title()
                                break
                        if status:
                            break

                    # Fallback: body text — non-delivered statuses FIRST
                    if not status:
                        lower = visible_text.lower()
                        if "unable to confirm" in lower or "tracking information not available" in lower:
                            status = "RM data expired"
                        elif "in transit" in lower:
                            status = "In transit"
                        elif "ready for delivery" in lower:
                            status = "Ready for delivery"
                        elif "we have your item" in lower:
                            status = "We have your item"
                        elif "item dispatched" in lower:
                            status = "Item dispatched"
                        elif "your item was delivered" in lower or "item delivered" in lower:
                            # Match specific RM result phrases, not the generic help link
                            # ("My item is shown as delivered but it hasn't been")
                            status = "Delivered"

                    # Extract delivery date — try near "delivered" first, then anywhere
                    delivery_date = None
                    if status and "delivered" in status.lower():
                        date_match = DATE_PATTERN_NEAR_DELIVERED.search(visible_text)
                        if date_match:
                            delivery_date = _parse_rm_date(date_match.group(1))
                        if not delivery_date:
                            for m in DATE_PATTERN_ANY.finditer(visible_text):
                                parsed = _parse_rm_date(m.group(1))
                                if parsed:
                                    delivery_date = parsed
                                    break

                    results[tracking] = {
                        "rm_status": status or "Unknown",
                        "rm_delivery_date": delivery_date,
                    }

                    if delivery_date:
                        log.debug("  %s: %s date=%s", tracking, status, delivery_date)
                    elif status and "delivered" in status.lower():
                        log.warning("  %s: %s but NO DATE found in page text (%d chars)",
                                    tracking, status, len(visible_text))
                    elif status and status != "Unknown":
                        log.debug("  %s: %s (no date)", tracking, status)

                except Exception as e:
                    log.warning("Error looking up %s: %s", tracking, e)
                    results[tracking] = {"rm_status": "Lookup failed", "rm_delivery_date": None}

                # Pause between lookups
                if i < len(tracking_numbers) - 1:
                    time.sleep(LOOKUP_PAUSE_SECS)

            log.info("Completed RM lookups: %d total, %d with dates",
                     len(results),
                     sum(1 for r in results.values() if r.get("rm_delivery_date")))

        finally:
            try:
                page.close()
            except Exception:
                pass
            browser.close()

    # Kill Chrome if we launched it
    if chrome_proc:
        try:
            chrome_proc.kill()
            log.debug("Chrome process killed")
        except Exception:
            pass

    return results


def map_results_to_orders(
    rm_results: dict[str, dict],
    orders: list[dict],
) -> dict[str, dict]:
    """Map RM tracking results back to order IDs."""
    mapped = {}
    for order in orders:
        tracking = order.get("tracking_number")
        if tracking and tracking in rm_results:
            mapped[order["platform_order_id"]] = rm_results[tracking]
    return mapped
