"""
Import Keepa price history for active sets with ASINs.

Phase 2 of investment model v2.1 data gap fixes.

Steps:
1. Query seeded_asins joined to brickset_sets for active sets with discovery_status='found'
2. Extract unique ASINs
3. Batch into groups of 100
4. POST each batch to HB Keepa import endpoint
5. Log results

Usage:
    python import_active_keepa.py
    # Requires HadleyBricks running on localhost:3000
    # Uses SUPABASE_SERVICE_ROLE_KEY from .env.local for auth
"""

import logging
import time

import requests
from supabase import create_client

from config import SUPABASE_URL, SUPABASE_KEY

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger(__name__)

HB_BASE_URL = "http://localhost:3000"
KEEPA_IMPORT_ENDPOINT = f"{HB_BASE_URL}/api/admin/keepa-import"
BATCH_SIZE = 100
BATCH_DELAY_SECONDS = 60  # Keepa rate limit: ~20 tokens/min, 100 ASINs ≈ 30 tokens

supabase = create_client(SUPABASE_URL, SUPABASE_KEY)


def fetch_active_asins() -> list[str]:
    """Fetch ASINs for active sets from seeded_asins."""
    all_asins = []
    offset = 0
    page_size = 1000
    while True:
        resp = (
            supabase.table("seeded_asins")
            .select("asin, brickset_set_id, brickset_sets!inner(retirement_status)")
            .eq("discovery_status", "found")
            .not_.is_("asin", "null")
            .in_("brickset_sets.retirement_status", ["available", "retiring_soon"])
            .order("created_at")
            .range(offset, offset + page_size - 1)
            .execute()
        )
        if not resp.data:
            break
        for row in resp.data:
            if row.get("asin"):
                all_asins.append(row["asin"])
        if len(resp.data) < page_size:
            break
        offset += page_size

    unique = list(dict.fromkeys(all_asins))  # Dedupe preserving order
    log.info(f"Found {len(unique)} unique ASINs for active sets")
    return unique


def check_existing_snapshots(asins: list[str]) -> set[str]:
    """Check which ASINs already have price_snapshots data (via set_num mapping)."""
    # First get ASIN -> set_num mapping
    asin_to_set = {}
    batch_size = 100
    for i in range(0, len(asins), batch_size):
        batch = asins[i : i + batch_size]
        resp = (
            supabase.table("seeded_asins")
            .select("asin, brickset_sets!inner(set_number)")
            .in_("asin", batch)
            .execute()
        )
        if resp.data:
            for row in resp.data:
                asin = row.get("asin")
                bs = row.get("brickset_sets")
                if asin and bs:
                    set_num = bs.get("set_number") if isinstance(bs, dict) else None
                    if set_num:
                        asin_to_set[asin] = set_num

    if not asin_to_set:
        return set()

    # Check which set_nums have keepa data
    set_nums = list(set(asin_to_set.values()))
    sets_with_data = set()
    for i in range(0, len(set_nums), batch_size):
        batch = set_nums[i : i + batch_size]
        resp = (
            supabase.table("price_snapshots")
            .select("set_num")
            .eq("source", "keepa_amazon_buybox")
            .in_("set_num", batch)
            .limit(1000)
            .execute()
        )
        if resp.data:
            for row in resp.data:
                sets_with_data.add(row["set_num"])

    # Return ASINs that already have data
    already_imported = set()
    for asin, set_num in asin_to_set.items():
        if set_num in sets_with_data:
            already_imported.add(asin)

    return already_imported


def import_batch(asins: list[str], auth_token: str) -> dict:
    """POST a batch of ASINs to the Keepa import endpoint."""
    resp = requests.post(
        KEEPA_IMPORT_ENDPOINT,
        json={"asins": asins},
        headers={
            "Authorization": f"Bearer {auth_token}",
            "Content-Type": "application/json",
        },
        timeout=300,  # Keepa calls can be slow
    )
    resp.raise_for_status()
    return resp.json()


def run() -> dict:
    """Execute the Keepa import pipeline."""
    log.info("=== Import Keepa Price History for Active Sets ===")

    # 1. Fetch ASINs
    asins = fetch_active_asins()
    if not asins:
        log.info("No active ASINs found — nothing to do")
        return {"total_asins": 0, "imported": 0, "skipped": 0, "failed": 0}

    # 2. Filter out already-imported ASINs
    already_imported = check_existing_snapshots(asins)
    new_asins = [a for a in asins if a not in already_imported]
    log.info(
        f"Skipping {len(already_imported)} ASINs with existing data, "
        f"{len(new_asins)} to import"
    )

    if not new_asins:
        log.info("All ASINs already have price data — nothing to do")
        return {
            "total_asins": len(asins),
            "already_imported": len(already_imported),
            "imported": 0,
            "skipped": 0,
            "failed": 0,
        }

    # 3. Batch and import
    total_snapshots = 0
    total_successful = 0
    total_failed = 0
    total_skipped = 0
    batch_count = (len(new_asins) + BATCH_SIZE - 1) // BATCH_SIZE

    for i in range(0, len(new_asins), BATCH_SIZE):
        batch = new_asins[i : i + BATCH_SIZE]
        batch_num = (i // BATCH_SIZE) + 1
        log.info(f"Batch {batch_num}/{batch_count}: {len(batch)} ASINs")

        try:
            result = import_batch(batch, SUPABASE_KEY)
            stats = result.get("stats", {})
            total_snapshots += stats.get("total_snapshots_imported", 0)
            total_successful += stats.get("successful", 0)
            total_failed += stats.get("failed", 0)
            total_skipped += stats.get("skipped_no_data", 0)
            log.info(
                f"  -> {stats.get('total_snapshots_imported', 0)} snapshots, "
                f"{stats.get('successful', 0)} ok, "
                f"{stats.get('failed', 0)} failed"
            )
        except requests.exceptions.RequestException as e:
            log.error(f"  -> Batch {batch_num} failed: {e}")
            total_failed += len(batch)

        # Wait between batches for Keepa rate limit
        if i + BATCH_SIZE < len(new_asins):
            log.info(f"  Waiting {BATCH_DELAY_SECONDS}s for Keepa rate limit...")
            time.sleep(BATCH_DELAY_SECONDS)

    summary = {
        "total_asins": len(asins),
        "already_imported": len(already_imported),
        "new_asins_processed": len(new_asins),
        "total_snapshots": total_snapshots,
        "successful": total_successful,
        "failed": total_failed,
        "skipped_no_data": total_skipped,
    }
    log.info(f"=== Keepa Import Complete ===\n{summary}")
    return summary


if __name__ == "__main__":
    # Quick health check
    try:
        resp = requests.get(f"{HB_BASE_URL}/api/health", timeout=5)
    except requests.exceptions.ConnectionError:
        # HB doesn't have /api/health — try a known endpoint
        try:
            resp = requests.get(HB_BASE_URL, timeout=5)
        except requests.exceptions.ConnectionError:
            log.error(
                "Cannot reach HadleyBricks at localhost:3000. "
                "Make sure the NSSM service is running."
            )
            raise SystemExit(1)

    run()
