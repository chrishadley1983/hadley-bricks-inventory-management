"""
Master orchestrator: runs all school integration scripts in sequence.
Designed to be run weekly (e.g. Friday evening or Saturday morning).

Usage: python scripts/school/run_all.py [--component NAME]

Components:
  term_dates     - Poll for updated term date PDFs
  newsletters    - Scrape new newsletters and extract events
  calendar_sync  - Push events to Google Calendar
  arbor          - Scrape Arbor portal (balances, attendance)
  all            - Run everything (default)
"""
import argparse
import subprocess
import sys
import os
from datetime import datetime

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))


def run_script(name: str, script: str) -> bool:
    """Run a Python script and return success status."""
    print(f"\n{'='*60}")
    print(f"  Running: {name}")
    print(f"  Time: {datetime.now().strftime('%H:%M:%S')}")
    print(f"{'='*60}\n")

    result = subprocess.run(
        [sys.executable, os.path.join(SCRIPT_DIR, script)],
        cwd=os.path.join(SCRIPT_DIR, "..", ".."),
        timeout=300,
    )
    success = result.returncode == 0
    status = "OK" if success else "FAILED"
    print(f"\n  [{status}] {name}\n")
    return success


def main():
    parser = argparse.ArgumentParser(description="School integration orchestrator")
    parser.add_argument("--component", default="all", choices=[
        "term_dates", "newsletters", "calendar_sync", "arbor", "all"
    ])
    args = parser.parse_args()

    print(f"School Integration Run - {datetime.now().strftime('%Y-%m-%d %H:%M')}")
    print(f"Component: {args.component}")

    results = {}

    if args.component in ("term_dates", "all"):
        results["Term Dates Poller"] = run_script("Term Dates Poller", "term_dates_poller.py")

    if args.component in ("newsletters", "all"):
        results["Newsletter Scraper"] = run_script("Newsletter Scraper", "newsletter_scraper.py")

    if args.component in ("calendar_sync", "all"):
        results["Calendar Sync"] = run_script("Calendar Sync", "calendar_sync.py")

    if args.component in ("arbor", "all"):
        results["Arbor Scraper"] = run_script("Arbor Scraper", "arbor_scraper.py")

    print(f"\n{'='*60}")
    print("  SUMMARY")
    print(f"{'='*60}")
    for name, success in results.items():
        status = "OK" if success else "FAILED"
        print(f"  [{status}] {name}")
    print()

    failed = [n for n, s in results.items() if not s]
    if failed:
        print(f"WARNING: {len(failed)} component(s) failed: {', '.join(failed)}")
        sys.exit(1)
    else:
        print("All components completed successfully.")


if __name__ == "__main__":
    main()
