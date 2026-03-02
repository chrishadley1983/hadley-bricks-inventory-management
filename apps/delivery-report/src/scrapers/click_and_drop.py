"""
Click & Drop scraper — Playwright automation to:
1. Login to Royal Mail Click & Drop
2. Download the Manifested Orders XLS export
3. Parse tracking numbers matched to Amazon order references
"""

import logging
import re
import tempfile
import time
from datetime import datetime, timedelta
from pathlib import Path

from playwright.sync_api import Browser, Page, sync_playwright

from src.config import CLICK_DROP_EMAIL, CLICK_DROP_PASSWORD

log = logging.getLogger(__name__)

MANIFESTED_ORDERS_URL = "https://business.parcel.royalmail.com/reports/manifested-orders/"
LOGIN_URL_PREFIX = "auth.parcel.royalmail.com"
AMAZON_ORDER_PATTERN = re.compile(r"\d{3}-\d{7}-\d{7}")


def scrape_tracking(days: int = 28) -> dict[str, dict]:
    """
    Login to Click & Drop, download XLS export, parse Amazon tracking data.

    Returns:
        Dict of order_id -> {tracking, cd_status, despatch_date}
    """
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        try:
            context = browser.new_context(accept_downloads=True)
            page = context.new_page()
            _login(page)
            xls_path = _download_xls(page)
            if xls_path:
                return _parse_xls(xls_path, days)
            else:
                log.warning("XLS download failed, falling back to DOM scraping")
                return _scrape_dom(page, days)
        finally:
            browser.close()


def _login(page: Page) -> None:
    """Navigate to manifested orders, handle login if redirected."""
    log.info("Navigating to Click & Drop manifested orders")
    page.goto(MANIFESTED_ORDERS_URL, wait_until="networkidle", timeout=30000)

    # Check if redirected to login
    if LOGIN_URL_PREFIX in page.url:
        log.info("Login required, entering credentials")
        # Fill email if empty
        email_input = page.locator('input[type="email"], input[name="email"], #email')
        if email_input.count() > 0:
            current = email_input.first.input_value()
            if not current:
                email_input.first.fill(CLICK_DROP_EMAIL)

        # Fill password if empty
        pw_input = page.locator('input[type="password"], input[name="password"], #password')
        if pw_input.count() > 0:
            current = pw_input.first.input_value()
            if not current:
                pw_input.first.fill(CLICK_DROP_PASSWORD)

        # Click sign in
        sign_in = page.locator('button:has-text("Sign In"), input[type="submit"]')
        if sign_in.count() > 0:
            sign_in.first.click()

        # Wait for redirect back to manifested orders
        page.wait_for_url(f"**{MANIFESTED_ORDERS_URL}**", timeout=15000)
        log.info("Login successful")


def _download_xls(page: Page) -> Path | None:
    """Click the Export/Download button and save the XLS file."""
    log.info("Looking for XLS export button")

    # Try various button selectors
    export_selectors = [
        'button:has-text("Export")',
        'a:has-text("Export")',
        'button:has-text("Download")',
        'a:has-text("Download XLS")',
        '[data-testid="export"]',
    ]

    for selector in export_selectors:
        btn = page.locator(selector)
        if btn.count() > 0:
            log.info("Found export button: %s", selector)
            with page.expect_download(timeout=30000) as download_info:
                btn.first.click()
            download = download_info.value

            # Save to temp file
            tmp = Path(tempfile.mkdtemp()) / download.suggested_filename
            download.save_as(str(tmp))
            log.info("Downloaded XLS: %s (%d bytes)", tmp.name, tmp.stat().st_size)
            return tmp

    log.warning("No export button found on page")
    return None


def _parse_xls(xls_path: Path, days: int = 28) -> dict[str, dict]:
    """Parse the Click & Drop XLS export using openpyxl."""
    import openpyxl

    log.info("Parsing XLS: %s", xls_path)
    wb = openpyxl.load_workbook(str(xls_path), read_only=True)
    ws = wb.active

    rows = list(ws.iter_rows(values_only=True))
    if not rows:
        log.warning("XLS file is empty")
        return {}

    headers = [str(h or "").strip() for h in rows[0]]

    # Find column indexes
    def find_col(names: list[str]) -> int | None:
        for name in names:
            name_lower = name.lower()
            for i, h in enumerate(headers):
                if h.lower() == name_lower:
                    return i
        return None

    channel_idx = find_col(["Channel"])
    ref_idx = find_col(["Channel reference"])
    despatch_idx = find_col(["Despatch date"])
    tracking_idx = find_col(["Tracking number"])
    status_idx = find_col(["Tracking status"])

    if ref_idx is None or tracking_idx is None:
        log.error("Required columns not found in XLS. Headers: %s", headers)
        return {}

    cutoff = datetime.now() - timedelta(days=days)
    results = {}

    for row in rows[1:]:
        # Filter for Amazon orders
        if channel_idx is not None:
            channel = str(row[channel_idx] or "")
            if "Amazon" not in channel:
                continue

        # Parse order reference
        ref = str(row[ref_idx] or "").strip()
        if not AMAZON_ORDER_PATTERN.match(ref) or ref == "*":
            continue

        # Parse despatch date
        if despatch_idx is not None:
            raw_date = row[despatch_idx]
            if isinstance(raw_date, datetime):
                despatch = raw_date.date()
            elif isinstance(raw_date, str):
                try:
                    despatch = datetime.strptime(raw_date[:10], "%Y-%m-%d").date()
                except ValueError:
                    continue
            else:
                continue

            if despatch < cutoff.date():
                continue

            despatch_str = despatch.strftime("%Y-%m-%d")
        else:
            despatch_str = None

        tracking = str(row[tracking_idx] or "").strip()
        cd_status = str(row[status_idx] or "").strip() if status_idx is not None else ""

        if tracking:
            results[ref] = {
                "tracking": tracking,
                "cd_status": cd_status,
                "despatch_date": despatch_str,
            }

    log.info("Parsed %d Amazon orders with tracking from XLS", len(results))
    return results


def _scrape_dom(page: Page, days: int = 28) -> dict[str, dict]:
    """Fallback: scrape the HTML table (page 1 only, up to 500 rows)."""
    log.info("Falling back to DOM scraping")

    # Wait for table to load
    page.wait_for_selector("table", timeout=15000)
    time.sleep(2)

    rows = page.locator("table tbody tr").all()
    results = {}

    for row in rows:
        cells = row.locator("td").all()
        if len(cells) < 6:
            continue

        texts = [c.inner_text().strip() for c in cells]

        # Column 0 = Channel, Column 1 = Order ref, Column ~5 = Tracking
        channel = texts[0] if len(texts) > 0 else ""
        if "Amazon" not in channel:
            continue

        ref_match = AMAZON_ORDER_PATTERN.search(texts[1] if len(texts) > 1 else "")
        if not ref_match:
            continue
        ref = ref_match.group(0)

        tracking = texts[-2] if len(texts) >= 2 else ""  # Tracking is usually second-to-last
        if tracking and len(tracking) > 5:
            results[ref] = {
                "tracking": tracking,
                "cd_status": texts[-1] if len(texts) >= 1 else "",
                "despatch_date": None,
            }

    log.info("Scraped %d Amazon orders from DOM", len(results))
    return results
