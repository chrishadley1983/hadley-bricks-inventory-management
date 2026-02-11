"""
Backfill UK RRP for active sets via multiple sources.

Phase 1 of investment model v2.1 data gap fixes.

Recovery waterfall:
1. Brickset API getSets (UK.retailPrice)
2. Amazon price fallback (seeded_asin_pricing.amazon_price)
3. Keepa P95 proxy (95th percentile of buy-box prices, capped at £500)
4. Regional price conversion (US × 0.867 or DE × 0.889)

Usage:
    python backfill_rrp.py --api-key <BRICKSET_API_KEY>
    python backfill_rrp.py --skip-brickset   # skip API call, run passes 2-4 only
"""

import argparse
import logging
import time
from collections import defaultdict

import numpy as np
import requests
from supabase import create_client

from config import SUPABASE_URL, SUPABASE_KEY

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger(__name__)

BRICKSET_API_BASE = "https://brickset.com/api/v3.asmx"

supabase = create_client(SUPABASE_URL, SUPABASE_KEY)


def fetch_missing_rrp_sets() -> list[dict]:
    """Fetch active sets with NULL or <5 uk_retail_price."""
    all_sets = []
    offset = 0
    page_size = 1000
    while True:
        resp = (
            supabase.table("brickset_sets")
            .select("set_number, set_name, retirement_status")
            .in_("retirement_status", ["available", "retiring_soon"])
            .or_("uk_retail_price.is.null,uk_retail_price.lt.5")
            .order("set_number")
            .range(offset, offset + page_size - 1)
            .execute()
        )
        if not resp.data:
            break
        all_sets.extend(resp.data)
        if len(resp.data) < page_size:
            break
        offset += page_size
    log.info(f"Found {len(all_sets)} active sets missing RRP")
    return all_sets


def call_brickset_get_sets(api_key: str, year: int, page: int = 1) -> dict:
    """Call Brickset getSets API for a given year with extended data."""
    import json

    params = json.dumps({"year": str(year)})
    form_data = {
        "apiKey": api_key,
        "userHash": "",
        "params": params,
        "pageSize": "500",
        "pageNumber": str(page),
        "extendedData": "1",
    }

    resp = requests.post(
        f"{BRICKSET_API_BASE}/getSets",
        data=form_data,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json()


def fetch_brickset_prices(api_key: str, years: list[int]) -> dict[str, float]:
    """Fetch UK retail prices from Brickset API for given years.

    Returns dict of set_number -> uk_retail_price.
    """
    prices = {}

    for year in years:
        page = 1
        while True:
            log.info(f"Brickset API: year={year}, page={page}")
            data = call_brickset_get_sets(api_key, year, page)

            if data.get("status") != "success":
                log.error(f"Brickset API error: {data.get('message', 'unknown')}")
                break

            sets = data.get("sets", [])
            if not sets:
                break

            for s in sets:
                set_num = s.get("number")
                variant = s.get("numberVariant", 1)
                if set_num is None:
                    continue
                # Build set_number in our format: "12345-1"
                set_number = f"{set_num}-{variant}"

                lego_com = s.get("LEGOCom", {})
                uk_data = lego_com.get("UK", {})
                uk_price = uk_data.get("retailPrice")

                if uk_price and float(uk_price) >= 5:
                    prices[set_number] = float(uk_price)

            matches = data.get("matches", 0)
            fetched_so_far = page * 500
            if fetched_so_far >= matches:
                break
            page += 1
            time.sleep(1)  # Rate limit courtesy

    log.info(f"Brickset API returned UK prices for {len(prices)} sets")
    return prices


def update_rrp_from_brickset(prices: dict[str, float], missing_sets: list[dict]) -> int:
    """Update brickset_sets.uk_retail_price from Brickset API results."""
    missing_nums = {s["set_number"] for s in missing_sets}
    updates = {sn: price for sn, price in prices.items() if sn in missing_nums}

    if not updates:
        log.info("No matches found in Brickset API response")
        return 0

    updated = 0
    for set_number, price in updates.items():
        resp = (
            supabase.table("brickset_sets")
            .update({"uk_retail_price": price})
            .eq("set_number", set_number)
            .execute()
        )
        if resp.data:
            updated += 1

    log.info(f"Updated {updated} sets from Brickset API")
    return updated


def fallback_from_amazon_pricing(missing_sets: list[dict], already_updated: set[str]) -> int:
    """Fallback: use seeded_asin_pricing.amazon_price for remaining gaps."""
    remaining = [s for s in missing_sets if s["set_number"] not in already_updated]
    if not remaining:
        return 0

    remaining_nums = [s["set_number"] for s in remaining]
    log.info(f"Trying Amazon price fallback for {len(remaining_nums)} remaining sets...")

    # Fetch in batches
    amazon_prices = {}
    batch_size = 100
    for i in range(0, len(remaining_nums), batch_size):
        batch = remaining_nums[i : i + batch_size]
        resp = (
            supabase.table("seeded_asin_pricing")
            .select("set_number, amazon_price")
            .in_("set_number", batch)
            .not_.is_("amazon_price", "null")
            .execute()
        )
        if resp.data:
            for row in resp.data:
                price = float(row["amazon_price"])
                if price >= 5:
                    amazon_prices[row["set_number"]] = price

    if not amazon_prices:
        log.info("No Amazon price fallbacks available")
        return 0

    updated = 0
    for set_number, price in amazon_prices.items():
        resp = (
            supabase.table("brickset_sets")
            .update({"uk_retail_price": price})
            .eq("set_number", set_number)
            .execute()
        )
        if resp.data:
            updated += 1

    log.info(f"Updated {updated} sets from Amazon price fallback")
    return updated


def fallback_from_keepa_p95(missing_sets: list[dict], already_updated: set[str]) -> tuple[int, set[str]]:
    """Fallback: use 95th percentile of Keepa buy-box prices as RRP proxy.

    Keepa sentinel values (>£500) are excluded. Validated against known RRP:
    median accuracy = 100%, 58% within ±10%.

    Fetches raw price data and computes P95 in Python (supabase-py
    doesn't support SQL aggregates).
    """
    remaining = [s for s in missing_sets if s["set_number"] not in already_updated]
    if not remaining:
        return 0, set()

    remaining_nums = [s["set_number"] for s in remaining]
    log.info(f"Trying Keepa P95 proxy for {len(remaining_nums)} remaining sets...")

    # Fetch raw price_snapshots in batches, accumulate per set_num
    prices_by_set: dict[str, list[float]] = defaultdict(list)
    batch_size = 20  # Small batches to avoid statement timeout
    for i in range(0, len(remaining_nums), batch_size):
        batch = remaining_nums[i : i + batch_size]
        offset = 0
        page_size = 1000
        while True:
            resp = (
                supabase.table("price_snapshots")
                .select("set_num, price_gbp")
                .eq("source", "keepa_amazon_buybox")
                .gt("price_gbp", 0)
                .lt("price_gbp", 500)
                .in_("set_num", batch)
                .order("set_num")
                .range(offset, offset + page_size - 1)
                .execute()
            )
            if not resp.data:
                break
            for row in resp.data:
                prices_by_set[row["set_num"]].append(float(row["price_gbp"]))
            if len(resp.data) < page_size:
                break
            offset += page_size

    # Compute P95 for each set with >= 3 snapshots
    keepa_prices = {}
    for set_num, prices in prices_by_set.items():
        if len(prices) >= 3:
            p95 = float(np.percentile(prices, 95))
            if p95 >= 5:
                keepa_prices[set_num] = round(p95, 2)

    if not keepa_prices:
        log.info("No Keepa P95 proxies available")
        return 0, set()

    log.info(f"Found Keepa P95 proxies for {len(keepa_prices)} sets (avg £{np.mean(list(keepa_prices.values())):.2f})")

    updated = 0
    updated_nums = set()
    for set_number, price in keepa_prices.items():
        resp = (
            supabase.table("brickset_sets")
            .update({"uk_retail_price": price})
            .eq("set_number", set_number)
            .execute()
        )
        if resp.data:
            updated += 1
            updated_nums.add(set_number)

    log.info(f"Updated {updated} sets from Keepa P95 proxy")
    return updated, updated_nums


def fallback_from_regional_prices(missing_sets: list[dict], already_updated: set[str]) -> int:
    """Fallback: convert US or DE retail price to estimated UK price.

    Conversion ratios derived from sets with both UK and regional prices:
    UK = US × 0.867 (median from 32 sets)
    UK = DE × 0.889 (median from 37 sets)
    """
    UK_US_RATIO = 0.867
    UK_DE_RATIO = 0.889

    remaining = [s for s in missing_sets if s["set_number"] not in already_updated]
    if not remaining:
        return 0

    remaining_nums = [s["set_number"] for s in remaining]
    log.info(f"Trying regional price conversion for {len(remaining_nums)} remaining sets...")

    # Fetch US and DE prices for remaining sets
    regional_prices = {}
    batch_size = 100
    for i in range(0, len(remaining_nums), batch_size):
        batch = remaining_nums[i : i + batch_size]
        resp = (
            supabase.table("brickset_sets")
            .select("set_number, us_retail_price, de_retail_price")
            .in_("set_number", batch)
            .execute()
        )
        if resp.data:
            for row in resp.data:
                sn = row["set_number"]
                us = row.get("us_retail_price")
                de = row.get("de_retail_price")
                # Prefer US (larger calibration sample)
                if us and float(us) >= 5:
                    regional_prices[sn] = round(float(us) * UK_US_RATIO, 2)
                elif de and float(de) >= 5:
                    regional_prices[sn] = round(float(de) * UK_DE_RATIO, 2)

    if not regional_prices:
        log.info("No regional price conversions available")
        return 0

    updated = 0
    for set_number, price in regional_prices.items():
        if price < 5:
            continue
        resp = (
            supabase.table("brickset_sets")
            .update({"uk_retail_price": price})
            .eq("set_number", set_number)
            .execute()
        )
        if resp.data:
            updated += 1

    log.info(f"Updated {updated} sets from regional price conversion")
    return updated


def run(api_key: str | None = None, skip_brickset: bool = False) -> dict:
    """Execute the RRP backfill pipeline.

    Waterfall: Brickset API → Amazon fallback → Keepa P95 → Regional conversion.
    Each pass re-fetches the missing list so tracking is accurate.
    """
    log.info("=== Backfill UK RRP ===")

    # 1. Get sets missing RRP
    missing_sets = fetch_missing_rrp_sets()
    if not missing_sets:
        log.info("No sets missing RRP — nothing to do")
        return {"brickset_updated": 0, "amazon_fallback": 0, "keepa_p95": 0, "regional": 0, "still_missing": 0}

    initial_missing = len(missing_sets)

    # Pass 1: Brickset API
    brickset_updated = 0
    if not skip_brickset and api_key:
        years = [2024, 2025, 2026]
        brickset_prices = fetch_brickset_prices(api_key, years)
        brickset_updated = update_rrp_from_brickset(brickset_prices, missing_sets)
    elif skip_brickset:
        log.info("Skipping Brickset API (--skip-brickset)")

    # Pass 2: Amazon price fallback (re-fetch missing list)
    missing_sets = fetch_missing_rrp_sets()
    amazon_updated = fallback_from_amazon_pricing(missing_sets, set())

    # Pass 3: Keepa P95 proxy (re-fetch missing list)
    missing_sets = fetch_missing_rrp_sets()
    keepa_updated, _ = fallback_from_keepa_p95(missing_sets, set())

    # Pass 4: Regional price conversion (re-fetch missing list)
    missing_sets = fetch_missing_rrp_sets()
    regional_updated = fallback_from_regional_prices(missing_sets, set())

    # Final count
    final_missing = len(fetch_missing_rrp_sets())

    summary = {
        "initial_missing": initial_missing,
        "brickset_updated": brickset_updated,
        "amazon_fallback": amazon_updated,
        "keepa_p95": keepa_updated,
        "regional": regional_updated,
        "still_missing": final_missing,
    }
    log.info(f"=== RRP Backfill Complete ===\n{summary}")
    return summary


if __name__ == "__main__":
    import os

    parser = argparse.ArgumentParser(description="Backfill UK RRP from multiple sources")
    parser.add_argument("--api-key", help="Brickset API key (or set BRICKSET_API_KEY env var)")
    parser.add_argument("--skip-brickset", action="store_true", help="Skip Brickset API, run passes 2-4 only")
    args = parser.parse_args()

    api_key = args.api_key or os.environ.get("BRICKSET_API_KEY")
    if not api_key and not args.skip_brickset:
        print("ERROR: Provide --api-key, set BRICKSET_API_KEY env var, or use --skip-brickset")
        raise SystemExit(1)

    run(api_key, skip_brickset=args.skip_brickset)
