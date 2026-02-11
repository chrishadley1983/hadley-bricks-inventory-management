"""
Investigate missing sets: BrickTap retiring list (465) vs our DB (416).

Reads the BrickTap CSV, queries brickset_sets, and reports which sets
are NOT in our database.

Usage:
    python check_missing_sets.py
"""

import csv
import logging
from pathlib import Path

from supabase import create_client

from config import SUPABASE_URL, SUPABASE_KEY

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger(__name__)

supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

CSV_PATH = Path.home() / "Downloads" / "Retiring_Bricktap_20260210 - Sheet1.csv"


def main():
    # Read BrickTap CSV
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
                })

    log.info(f"BrickTap CSV: {len(bricktap_sets)} sets")

    # Query DB for all these set numbers
    brickset_numbers = [s["brickset_number"] for s in bricktap_sets]
    found_in_db = set()

    batch_size = 100
    for i in range(0, len(brickset_numbers), batch_size):
        batch = brickset_numbers[i : i + batch_size]
        resp = (
            supabase.table("brickset_sets")
            .select("set_number, retirement_status, exit_date, uk_retail_price")
            .in_("set_number", batch)
            .execute()
        )
        for row in resp.data:
            found_in_db.add(row["set_number"])

    # Find missing
    missing = [s for s in bricktap_sets if s["brickset_number"] not in found_in_db]
    found = [s for s in bricktap_sets if s["brickset_number"] in found_in_db]

    log.info(f"Found in DB: {len(found)}")
    log.info(f"Missing from DB: {len(missing)}")

    if missing:
        print("\n=== MISSING SETS (not in brickset_sets) ===\n")
        print(f"{'Set #':<10} {'Theme':<25} {'Name':<50} {'Retirement Date'}")
        print("-" * 110)
        for s in sorted(missing, key=lambda x: x["theme"]):
            print(f"{s['raw_number']:<10} {s['theme']:<25} {s['name']:<50} {s['retirement_date']}")

    # Also check: sets in DB with 2026 exit_date but NOT in BrickTap list
    bricktap_set_numbers = set(s["brickset_number"] for s in bricktap_sets)
    db_2026 = []
    offset = 0
    while True:
        resp = (
            supabase.table("brickset_sets")
            .select("set_number, set_name, theme, exit_date, retirement_status")
            .gte("exit_date", "2026-01-01")
            .lt("exit_date", "2027-01-01")
            .order("set_number")
            .range(offset, offset + 999)
            .execute()
        )
        if not resp.data:
            break
        db_2026.extend(resp.data)
        if len(resp.data) < 1000:
            break
        offset += 1000

    db_only = [r for r in db_2026 if r["set_number"] not in bricktap_set_numbers]

    print(f"\n=== IN DB (2026 exit) BUT NOT IN BRICKTAP ({len(db_only)}) ===\n")
    if db_only:
        print(f"{'Set #':<12} {'Theme':<25} {'Name':<50} {'Status':<15} {'Exit Date'}")
        print("-" * 120)
        for r in sorted(db_only, key=lambda x: x.get("theme", "")):
            print(
                f"{r['set_number']:<12} {r.get('theme',''):<25} "
                f"{r.get('set_name',''):<50} {r.get('retirement_status',''):<15} "
                f"{r.get('exit_date','')}"
            )

    print(f"\n=== SUMMARY ===")
    print(f"BrickTap retiring 2026: {len(bricktap_sets)}")
    print(f"Found in our DB:        {len(found)}")
    print(f"Missing from DB:        {len(missing)}")
    print(f"In DB (2026 exit) total: {len(db_2026)}")
    print(f"In DB but not BrickTap: {len(db_only)}")


if __name__ == "__main__":
    main()
