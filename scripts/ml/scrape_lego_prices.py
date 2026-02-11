"""
Scrape UK retail prices from LEGO.com using Playwright.

For sets that have no RRP from any other source (Brickset API, Amazon,
Keepa, regional conversion), this script uses a headless browser to
fetch prices directly from lego.com/en-gb.

LEGO.com blocks automated HTTP requests (403), so we use Playwright
with a real Chromium browser to bypass this.

Prerequisites:
    pip install playwright
    playwright install chromium

Usage:
    python scrape_lego_prices.py              # scrape all missing
    python scrape_lego_prices.py --dry-run    # preview without writing
    python scrape_lego_prices.py --limit 10   # only scrape first 10
"""

import argparse
import json
import logging
import re
import time

from supabase import create_client

from config import SUPABASE_URL, SUPABASE_KEY

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger(__name__)

LEGO_BASE_URL = "https://www.lego.com/en-gb/product"

supabase = create_client(SUPABASE_URL, SUPABASE_KEY)


def fetch_sets_missing_rrp() -> list[dict]:
    """Fetch active sets still missing uk_retail_price after all other passes."""
    all_sets = []
    offset = 0
    page_size = 1000
    while True:
        resp = (
            supabase.table("brickset_sets")
            .select("set_number, set_name, theme, pieces, launch_date")
            .in_("retirement_status", ["available", "retiring_soon"])
            .or_("uk_retail_price.is.null,uk_retail_price.lt.5")
            .not_.is_("launch_date", "null")
            .not_.is_("pieces", "null")
            .gte("pieces", 10)
            .order("pieces", desc=True)
            .range(offset, offset + page_size - 1)
            .execute()
        )
        if not resp.data:
            break
        all_sets.extend(resp.data)
        if len(resp.data) < page_size:
            break
        offset += page_size

    # Filter out magazine freebies (6+ digit set numbers), CMFs, promos
    filtered = []
    for s in all_sets:
        num_part = s["set_number"].split("-")[0]
        if len(num_part) >= 6:
            continue
        if s.get("theme") in ("Collectable Minifigures", "Promotional", "Seasonal"):
            continue
        filtered.append(s)

    log.info(f"Found {len(filtered)} sets to scrape from LEGO.com")
    return filtered


def extract_price_from_page(page) -> float | None:
    """Extract UK price from a LEGO.com product page.

    Tries multiple strategies:
    1. JSON-LD structured data (most reliable)
    2. Data attribute on price element
    3. Text content matching £XX.XX pattern
    """
    # Strategy 1: JSON-LD structured data
    try:
        ld_scripts = page.query_selector_all('script[type="application/ld+json"]')
        for script in ld_scripts:
            text = script.inner_text()
            data = json.loads(text)
            # Could be a single object or array
            items = data if isinstance(data, list) else [data]
            for item in items:
                offers = item.get("offers", {})
                if isinstance(offers, list):
                    for offer in offers:
                        price = offer.get("price")
                        currency = offer.get("priceCurrency", "")
                        if price and currency == "GBP":
                            return float(price)
                elif isinstance(offers, dict):
                    price = offers.get("price")
                    currency = offers.get("priceCurrency", "")
                    if price and currency == "GBP":
                        return float(price)
    except Exception as e:
        log.debug(f"JSON-LD extraction failed: {e}")

    # Strategy 2: Look for price in page content via data-test attributes
    try:
        price_el = page.query_selector('[data-test="product-price"]')
        if not price_el:
            price_el = page.query_selector('[data-test="product-price-sale"]')
        if price_el:
            text = price_el.inner_text()
            match = re.search(r"£([\d,]+\.?\d*)", text)
            if match:
                return float(match.group(1).replace(",", ""))
    except Exception as e:
        log.debug(f"Data-test extraction failed: {e}")

    # Strategy 3: Search all text for £XX.XX pattern
    try:
        body_text = page.inner_text("body")
        # Find all GBP prices, take the first reasonable one
        prices = re.findall(r"£([\d,]+\.?\d{0,2})", body_text)
        for p in prices:
            val = float(p.replace(",", ""))
            if 3 <= val <= 1000:  # Reasonable LEGO price range
                return val
    except Exception as e:
        log.debug(f"Text pattern extraction failed: {e}")

    return None


def scrape_prices(sets: list[dict], dry_run: bool = False) -> dict:
    """Scrape prices from LEGO.com using Playwright."""
    from playwright.sync_api import sync_playwright

    results = {"found": 0, "not_found": 0, "error": 0, "updated": 0}
    prices_found = {}

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(
            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/131.0.0.0 Safari/537.36"
            ),
            locale="en-GB",
            timezone_id="Europe/London",
        )
        page = context.new_page()

        # Warmup: visit LEGO.com homepage to clear Cloudflare challenge
        log.info("Warming up browser (clearing Cloudflare)...")
        page.goto("https://www.lego.com/en-gb", wait_until="domcontentloaded", timeout=30000)
        page.wait_for_timeout(5000)
        log.info(f"  Warmup page title: {page.title()[:60]}")

        for i, s in enumerate(sets):
            set_num = s["set_number"].split("-")[0]  # "75419-1" -> "75419"
            url = f"{LEGO_BASE_URL}/{set_num}"

            log.info(f"[{i+1}/{len(sets)}] {s['set_number']} {s['set_name']}: {url}")

            max_attempts = 2
            for attempt in range(max_attempts):
                try:
                    resp = page.goto(url, wait_until="domcontentloaded", timeout=30000)

                    if resp and resp.status == 404:
                        log.info(f"  -> 404 Not Found")
                        results["not_found"] += 1
                        break

                    # Wait for price to render (React hydration)
                    page.wait_for_timeout(4000)

                    # Check for Cloudflare challenge
                    title = page.title()
                    if "just a moment" in title.lower():
                        if attempt < max_attempts - 1:
                            log.info(f"  -> Cloudflare challenge, waiting 8s and retrying...")
                            page.wait_for_timeout(8000)
                            continue
                        else:
                            log.info(f"  -> Cloudflare blocked after {max_attempts} attempts")
                            results["not_found"] += 1
                            break

                    price = extract_price_from_page(page)

                    if price and price >= 5:
                        log.info(f"  -> £{price:.2f}")
                        prices_found[s["set_number"]] = price
                        results["found"] += 1
                    else:
                        log.info(f"  -> No price found (page title: {title[:60]})")
                        results["not_found"] += 1
                    break

                except Exception as e:
                    if attempt < max_attempts - 1:
                        log.warning(f"  -> Attempt {attempt+1} failed: {e}, retrying...")
                        time.sleep(3)
                    else:
                        log.error(f"  -> Error: {e}")
                        results["error"] += 1

            # Be polite: 2-4 second delay between requests
            time.sleep(2 + (i % 3))

        browser.close()

    # Update Supabase
    if prices_found and not dry_run:
        log.info(f"\nUpdating {len(prices_found)} prices in Supabase...")
        for set_number, price in prices_found.items():
            resp = (
                supabase.table("brickset_sets")
                .update({"uk_retail_price": price})
                .eq("set_number", set_number)
                .execute()
            )
            if resp.data:
                results["updated"] += 1
    elif dry_run:
        log.info(f"\n[DRY RUN] Would update {len(prices_found)} prices:")
        for sn, price in prices_found.items():
            log.info(f"  {sn}: £{price:.2f}")

    return results


def run(dry_run: bool = False, limit: int | None = None) -> dict:
    """Execute the LEGO.com scrape pipeline."""
    log.info("=== Scrape LEGO.com UK Prices ===")

    sets = fetch_sets_missing_rrp()
    if not sets:
        log.info("No sets to scrape — all have RRP")
        return {"found": 0, "not_found": 0, "error": 0, "updated": 0}

    if limit:
        sets = sets[:limit]
        log.info(f"Limited to {limit} sets")

    results = scrape_prices(sets, dry_run=dry_run)

    log.info(f"=== LEGO.com Scrape Complete ===\n{results}")
    return results


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Scrape UK prices from LEGO.com")
    parser.add_argument("--dry-run", action="store_true", help="Preview without writing to DB")
    parser.add_argument("--limit", type=int, help="Max sets to scrape")
    args = parser.parse_args()

    run(dry_run=args.dry_run, limit=args.limit)
