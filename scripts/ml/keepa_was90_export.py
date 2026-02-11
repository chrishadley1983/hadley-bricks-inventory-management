"""
Keepa was90 + price-1yr-ago CSV export for recently retired sets (2024-2025).

Reads the BrickTap retired CSV (858 sets), maps set numbers to ASINs via
Supabase (seeded_asins), calls the Keepa REST API for price history, and
outputs a CSV with was90, price-1yr-ago, and current buy box price.

Usage:
    python keepa_was90_export.py

Requires:
    KEEPA_API_KEY environment variable (loaded from apps/web/.env.local)

Rate limiting:
    ~3 tokens per batch of 10 ASINs, 20 tokens/min refill.
    ~86 batches for 858 sets = ~258 tokens = ~13 minutes.
"""

import csv
import logging
import os
import time
from datetime import datetime, timedelta
from pathlib import Path

import requests
from supabase import create_client

from config import SUPABASE_URL, SUPABASE_KEY

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger(__name__)

supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

# Load Keepa API key from .env.local (same place config.py loads from)
_project_root = Path(__file__).resolve().parent.parent.parent
_env_path = _project_root / "apps" / "web" / ".env.local"
if _env_path.exists():
    with open(_env_path) as f:
        for line in f:
            line = line.strip()
            if line.startswith("KEEPA_API_KEY="):
                os.environ.setdefault("KEEPA_API_KEY", line.split("=", 1)[1])

KEEPA_API_KEY = os.environ.get("KEEPA_API_KEY", "")
KEEPA_BASE_URL = "https://api.keepa.com"

CSV_PATH = Path.home() / "Downloads" / "Retired_Bricktap_20260210 - Sheet1.csv"
REPORT_DIR = Path(__file__).resolve().parent / "reports"
REPORT_DIR.mkdir(exist_ok=True)
OUTPUT_PATH = REPORT_DIR / "retired_sets_keepa_prices.csv"

# Keepa constants
KEEPA_EPOCH_MINUTES = 21564000  # Minutes from Unix epoch to 2011-01-01
BUY_BOX_CSV_INDEX = 18
KEEPA_DOMAIN_UK = 2


def keepa_minutes_to_datetime(keepa_min: int) -> datetime:
    """Convert Keepa timestamp (minutes since 2011-01-01) to datetime."""
    unix_seconds = (keepa_min + KEEPA_EPOCH_MINUTES) * 60
    return datetime.utcfromtimestamp(unix_seconds)


def parse_keepa_csv_pairs(csv_data: list[int] | None) -> list[tuple[datetime, float]]:
    """Parse Keepa CSV [timestamp, value, timestamp, value, ...] into (datetime, price_gbp) pairs."""
    if not csv_data or len(csv_data) < 2:
        return []
    pairs = []
    for i in range(0, len(csv_data) - 1, 2):
        ts = csv_data[i]
        val = csv_data[i + 1]
        if val >= 0:  # -1 means out of stock
            dt = keepa_minutes_to_datetime(ts)
            price_gbp = val / 100.0  # Keepa stores in pence
            pairs.append((dt, price_gbp))
    return pairs


def fetch_keepa_batch(asins: list[str], tokens_left: int) -> tuple[list[dict], int]:
    """Fetch Keepa product data for a batch of up to 10 ASINs.

    Returns (products_list, tokens_remaining).
    """
    if not KEEPA_API_KEY:
        raise ValueError("KEEPA_API_KEY not set")

    params = {
        "key": KEEPA_API_KEY,
        "domain": str(KEEPA_DOMAIN_UK),
        "asin": ",".join(asins),
        "stats": "90",
        "buybox": "1",
        "history": "1",
    }

    for attempt in range(4):
        resp = requests.get(f"{KEEPA_BASE_URL}/product", params=params, timeout=30)

        if resp.status_code == 429:
            data = resp.json()
            refill_ms = data.get("refillIn", 60000)
            wait_s = max(refill_ms / 1000, 10) + 2
            log.warning(f"429 rate limited, waiting {wait_s:.0f}s (attempt {attempt+1})")
            time.sleep(wait_s)
            continue

        resp.raise_for_status()
        data = resp.json()

        if data.get("error"):
            raise RuntimeError(f"Keepa API error: {data['error']}")

        return data.get("products", []), data.get("tokensLeft", 0)

    raise RuntimeError("Keepa API: exceeded retry limit on 429")


def extract_prices(product: dict) -> dict:
    """Extract was90, price-1yr-ago, and current price from a Keepa product."""
    result = {
        "asin": product.get("asin", ""),
        "current_buy_box": None,
        "was90": None,
        "price_1yr_ago": None,
    }

    # was90 from stats
    stats = product.get("stats", {})
    if stats:
        # stats.avg90 is an array indexed by CSV type
        avg90 = stats.get("avg90") or stats.get("avg90_BUYBOX")
        if isinstance(avg90, list) and len(avg90) > BUY_BOX_CSV_INDEX:
            val = avg90[BUY_BOX_CSV_INDEX]
            if val is not None and val >= 0:
                result["was90"] = val / 100.0

        # Current buy box from stats.current
        current = stats.get("current")
        if isinstance(current, list) and len(current) > BUY_BOX_CSV_INDEX:
            val = current[BUY_BOX_CSV_INDEX]
            if val is not None and val >= 0:
                result["current_buy_box"] = val / 100.0

    # Price 1 year ago from buy box CSV history
    csv_data = product.get("csv")
    if isinstance(csv_data, list) and len(csv_data) > BUY_BOX_CSV_INDEX:
        bb_csv = csv_data[BUY_BOX_CSV_INDEX]
        pairs = parse_keepa_csv_pairs(bb_csv)

        if pairs:
            # Current buy box fallback from CSV
            if result["current_buy_box"] is None:
                result["current_buy_box"] = pairs[-1][1]

            # Find price closest to 1 year ago
            target_date = datetime.utcnow() - timedelta(days=365)
            closest = min(pairs, key=lambda p: abs((p[0] - target_date).total_seconds()))
            # Only use if within 30 days of target
            if abs((closest[0] - target_date).days) <= 30:
                result["price_1yr_ago"] = closest[1]

    return result


def main():
    if not KEEPA_API_KEY:
        log.error("KEEPA_API_KEY not set. Check apps/web/.env.local")
        return

    # Step 1: Read BrickTap retired CSV
    bricktap_sets = []
    with open(CSV_PATH, encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            set_num_raw = row.get("Set #", "").strip()
            if set_num_raw:
                bricktap_sets.append({
                    "raw_number": set_num_raw,
                    "brickset_number": f"{set_num_raw}-1",
                    "name": row.get("Set Name", ""),
                    "theme": row.get("Theme", ""),
                    "retirement_date": row.get("Retirement Date", ""),
                    "piece_count": row.get("Piece Count", ""),
                })

    log.info(f"BrickTap retired CSV: {len(bricktap_sets)} sets")

    # Step 2: Get set metadata + RRP from DB
    brickset_numbers = [s["brickset_number"] for s in bricktap_sets]
    set_meta = {}
    batch_size = 100
    for i in range(0, len(brickset_numbers), batch_size):
        batch = brickset_numbers[i : i + batch_size]
        resp = (
            supabase.table("brickset_sets")
            .select("id, set_number, set_name, theme, uk_retail_price")
            .in_("set_number", batch)
            .execute()
        )
        for row in resp.data:
            set_meta[row["set_number"]] = row

    log.info(f"Found {len(set_meta)} sets in DB")

    # Step 3: Map to ASINs via seeded_asins
    set_ids = [m["id"] for m in set_meta.values()]
    asin_map = {}  # brickset_set_id -> asin
    for i in range(0, len(set_ids), batch_size):
        batch = set_ids[i : i + batch_size]
        resp = (
            supabase.table("seeded_asins")
            .select("brickset_set_id, asin")
            .in_("brickset_set_id", batch)
            .eq("discovery_status", "found")
            .not_.is_("asin", "null")
            .execute()
        )
        for row in resp.data:
            if row.get("asin"):
                asin_map[row["brickset_set_id"]] = row["asin"]

    # Build set_number -> asin mapping
    sn_to_asin = {}
    for sn, meta in set_meta.items():
        asin = asin_map.get(meta["id"])
        if asin:
            sn_to_asin[sn] = asin

    log.info(f"ASINs found: {len(sn_to_asin)} / {len(set_meta)} sets")

    # Step 4: Call Keepa in batches of 10
    asins_to_fetch = list(set(sn_to_asin.values()))
    keepa_results = {}  # asin -> price_dict
    tokens_left = 20
    keepa_batch_size = 10

    log.info(f"Fetching Keepa data for {len(asins_to_fetch)} ASINs in batches of {keepa_batch_size}...")

    for i in range(0, len(asins_to_fetch), keepa_batch_size):
        batch = asins_to_fetch[i : i + keepa_batch_size]
        batch_num = i // keepa_batch_size + 1
        total_batches = (len(asins_to_fetch) + keepa_batch_size - 1) // keepa_batch_size

        # Rate limit: wait if tokens are low
        if tokens_left < 5 and i > 0:
            wait_s = 65  # Wait for full minute refill
            log.info(f"Tokens low ({tokens_left}), waiting {wait_s}s for refill...")
            time.sleep(wait_s)

        log.info(f"Batch {batch_num}/{total_batches}: {len(batch)} ASINs (tokens left: {tokens_left})")

        try:
            products, tokens_left = fetch_keepa_batch(batch, tokens_left)
            for product in products:
                prices = extract_prices(product)
                keepa_results[prices["asin"]] = prices
        except Exception as e:
            log.error(f"Batch {batch_num} failed: {e}")
            # Still continue with other batches

        # Minimum gap between requests
        if i + keepa_batch_size < len(asins_to_fetch):
            time.sleep(2)

    log.info(f"Keepa data fetched for {len(keepa_results)} ASINs")

    # Step 5: Build output CSV
    output_rows = []
    for bt_set in bricktap_sets:
        sn = bt_set["brickset_number"]
        meta = set_meta.get(sn, {})
        asin = sn_to_asin.get(sn, "")
        keepa = keepa_results.get(asin, {})

        output_rows.append({
            "Set Number": bt_set["raw_number"],
            "Set Name": bt_set["name"] or meta.get("set_name", ""),
            "Theme": bt_set["theme"] or meta.get("theme", ""),
            "RRP": meta.get("uk_retail_price", ""),
            "ASIN": asin,
            "Current Price": keepa.get("current_buy_box", ""),
            "Was90": keepa.get("was90", ""),
            "Price 1yr Ago": keepa.get("price_1yr_ago", ""),
            "Retirement Date": bt_set["retirement_date"],
        })

    with open(OUTPUT_PATH, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=[
            "Set Number", "Set Name", "Theme", "RRP", "ASIN",
            "Current Price", "Was90", "Price 1yr Ago", "Retirement Date",
        ])
        writer.writeheader()
        writer.writerows(output_rows)

    # Summary
    with_asin = sum(1 for r in output_rows if r["ASIN"])
    with_was90 = sum(1 for r in output_rows if r["Was90"] != "")
    with_1yr = sum(1 for r in output_rows if r["Price 1yr Ago"] != "")

    log.info(f"Output CSV written to {OUTPUT_PATH}")
    log.info(f"  Total rows: {len(output_rows)}")
    log.info(f"  With ASIN: {with_asin}")
    log.info(f"  With was90: {with_was90}")
    log.info(f"  With price 1yr ago: {with_1yr}")


if __name__ == "__main__":
    main()
