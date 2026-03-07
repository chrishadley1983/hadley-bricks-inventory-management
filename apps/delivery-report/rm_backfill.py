"""
Royal Mail tracking backfill — local scheduled job.

Runs 1 hour before Cloud Run delivery report (i.e. 6:00 AM UK).
Pulls orders needing RM lookups from the Supabase cache, looks them up
via Chrome CDP, and writes results back to the cache.

The Cloud Run report pipeline then reads the updated cache as-is.

Setup: See register_task_scheduler.ps1
"""

import json
import logging
import os
import sys
import urllib.request
from datetime import date, datetime

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger("rm-backfill")

# ── Config ────────────────────────────────────────────────────────────────

SUPABASE_URL = "https://modjoikyuhqzouxvieua.supabase.co"

# Try env var first, then .env file
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
if not SUPABASE_KEY:
    env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")
    if os.path.exists(env_path):
        with open(env_path) as f:
            for line in f:
                if line.startswith("SUPABASE_SERVICE_ROLE_KEY="):
                    SUPABASE_KEY = line.split("=", 1)[1].strip().strip('"')

# Also check the web app's .env.local
if not SUPABASE_KEY:
    env_local = os.path.join(
        os.path.dirname(os.path.abspath(__file__)), "..", "web", ".env.local"
    )
    if os.path.exists(env_local):
        with open(env_local) as f:
            for line in f:
                if line.startswith("SUPABASE_SERVICE_ROLE_KEY="):
                    SUPABASE_KEY = line.split("=", 1)[1].strip().strip('"')

if not SUPABASE_KEY:
    log.error("SUPABASE_SERVICE_ROLE_KEY not found")
    sys.exit(1)

MAX_LOOKUPS = 30  # More generous than Cloud Run — local has no time pressure

HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
}


# ── Supabase helpers ──────────────────────────────────────────────────────


def _supabase_get(path: str) -> list[dict]:
    """GET from Supabase REST API with pagination."""
    all_rows = []
    offset = 0
    limit = 1000
    while True:
        sep = "&" if "?" in path else "?"
        url = f"{SUPABASE_URL}/rest/v1/{path}{sep}offset={offset}&limit={limit}"
        req = urllib.request.Request(url, headers=HEADERS)
        with urllib.request.urlopen(req) as resp:
            rows = json.loads(resp.read().decode())
        all_rows.extend(rows)
        if len(rows) < limit:
            break
        offset += limit
    return all_rows


def _supabase_update(table: str, platform_order_id: str, updates: dict) -> None:
    """Update a single row in a Supabase table by platform_order_id."""
    url = (
        f"{SUPABASE_URL}/rest/v1/{table}"
        f"?platform_order_id=eq.{platform_order_id}"
    )
    data = json.dumps(updates).encode()
    req = urllib.request.Request(url, data=data, headers=HEADERS, method="PATCH")
    with urllib.request.urlopen(req) as resp:
        resp.read()


# ── Main ──────────────────────────────────────────────────────────────────


def main():
    log.info("=== RM Backfill Starting ===")

    # Add src to path for royal_mail_tracking import
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

    # Fetch cache entries that need RM lookup
    cache_rows = _supabase_get(
        "delivery_tracking_cache?select=*&order=order_date.desc"
    )
    log.info("Loaded %d cache entries", len(cache_rows))

    # Find orders needing lookup: needs_recheck=true AND has tracking number
    needs_lookup = [
        row for row in cache_rows
        if row.get("needs_recheck") and row.get("tracking_number")
    ]
    log.info("Found %d orders needing RM lookup", len(needs_lookup))

    if not needs_lookup:
        log.info("Nothing to do — all orders have RM data")
        return

    # Cap lookups
    if len(needs_lookup) > MAX_LOOKUPS:
        log.info("Capping from %d to %d lookups", len(needs_lookup), MAX_LOOKUPS)
        needs_lookup = needs_lookup[:MAX_LOOKUPS]

    tracking_numbers = [row["tracking_number"] for row in needs_lookup]

    # Do RM lookups via CDP
    from src.scrapers.royal_mail_tracking import lookup_tracking

    rm_results = lookup_tracking(tracking_numbers)

    # Update cache rows with results
    today = date.today().isoformat()
    updated_rows = []
    dates_found = 0

    for row in needs_lookup:
        tracking = row["tracking_number"]
        rm = rm_results.get(tracking, {})
        rm_status = rm.get("rm_status")
        rm_date = rm.get("rm_delivery_date")

        if not rm_status or rm_status in ("Unknown", "Lookup failed"):
            continue  # Don't overwrite good cached data with failures

        update = {
            "platform_order_id": row["platform_order_id"],
            "rm_status": rm_status,
            "last_checked": today,
            "updated_at": datetime.now().isoformat(),
        }

        if rm_date:
            update["rm_delivery_date"] = rm_date
            dates_found += 1

        # Mark as no longer needing recheck if delivered with a real date
        if "delivered" in rm_status.lower() and rm_date:
            update["needs_recheck"] = False
        elif "delivered" in rm_status.lower() and not rm_date:
            update["needs_recheck"] = True  # Still need real date
        elif rm_status == "RM data expired":
            update["needs_recheck"] = False  # Won't get better
        else:
            update["needs_recheck"] = True  # Not delivered yet

        updated_rows.append(update)

    if updated_rows:
        for row in updated_rows:
            oid = row.pop("platform_order_id")
            _supabase_update("delivery_tracking_cache", oid, row)
        log.info(
            "Updated %d cache entries (%d with delivery dates)",
            len(updated_rows),
            dates_found,
        )
    else:
        log.info("No successful lookups to update")

    log.info("=== RM Backfill Complete ===")


if __name__ == "__main__":
    main()
