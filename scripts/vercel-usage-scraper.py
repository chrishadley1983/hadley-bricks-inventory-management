"""
Vercel Dashboard Usage Scraper — local scheduled job.

Runs at 06:30 daily (before the 07:00 vercel-usage cron report).
Uses Chrome CDP to navigate to the Vercel usage dashboard, scrape
all metric values, and write them to the scraped_metrics table.

The vercel-usage cron route then merges these scraped values into
the report alongside v2 API data.

Setup: Run register_task.ps1 to schedule in Windows Task Scheduler.
Requires: Chrome CDP running on port 9222 (see chrome-cdp-setup memory).
"""

import json
import logging
import os
import re
import sys
import time
import urllib.request
from datetime import datetime

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger("vercel-scraper")

# ── Config ────────────────────────────────────────────────────────────────

SUPABASE_URL = "https://modjoikyuhqzouxvieua.supabase.co"
VERCEL_USAGE_URL = "https://vercel.com/chrishadley1983s-projects/~/usage"

# Supabase key lookup (same chain as rm_backfill.py)
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
if not SUPABASE_KEY:
    for env_path in [
        os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "apps", "web", ".env.local"),
        os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "apps", "delivery-report", ".env"),
    ]:
        if os.path.exists(env_path):
            with open(env_path) as f:
                for line in f:
                    if line.startswith("SUPABASE_SERVICE_ROLE_KEY="):
                        SUPABASE_KEY = line.split("=", 1)[1].strip().strip('"')
            if SUPABASE_KEY:
                break

if not SUPABASE_KEY:
    log.error("SUPABASE_SERVICE_ROLE_KEY not found")
    sys.exit(1)

HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
    "Prefer": "resolution=merge-duplicates",
}

# Metric name mapping: dashboard label → DB key + unit
METRIC_MAP = {
    "Fluid Active CPU": ("vercel_fluid_active_cpu", "seconds"),
    "Fluid Provisioned Memory": ("vercel_fluid_provisioned_memory", "GB-Hrs"),
    "Function Invocations": ("vercel_function_invocations", "count"),
    "Function Duration": ("vercel_function_duration", "GB-Hrs"),
    "Edge Requests": ("vercel_edge_requests", "count"),
    "Edge Request CPU Duration": ("vercel_edge_request_cpu_duration", "seconds"),
    "Edge Function Execution Units": ("vercel_edge_function_execution_units", "count"),
    "Edge Middleware Invocations": ("vercel_edge_middleware_invocations", "count"),
    "Fast Data Transfer": ("vercel_fast_data_transfer", "GB"),
    "Fast Origin Transfer": ("vercel_fast_origin_transfer", "GB"),
    "ISR Reads": ("vercel_isr_reads", "count"),
    "ISR Writes": ("vercel_isr_writes", "count"),
    "Microfrontends Routing": ("vercel_microfrontends_routing", "count"),
    "Blob Data Storage": ("vercel_blob_data_storage", "GB"),
    "Blob Simple Operations": ("vercel_blob_simple_operations", "count"),
}


def _convert_to_base_unit(raw: str, target_unit: str) -> float:
    """Convert a scraped value string to the base unit expected by the DB.

    Examples:
        "2 hours" with target "seconds" → 7200.0
        "358 MB" with target "GB" → 0.358
        "63.75K" with target "count" → 63750.0
        "115.46 GB Hrs" with target "GB-Hrs" → 115.46
        "12.5 seconds" with target "seconds" → 12.5
    """
    text = raw.strip().replace(",", "")

    # Handle time values (hours, minutes, seconds)
    if target_unit == "seconds":
        return _parse_time_value(text)

    # Handle GB-Hrs (keep as-is, just extract number)
    if target_unit == "GB-Hrs":
        num = re.search(r'([\d.]+)', text)
        return float(num.group(1)) if num else 0.0

    # Handle data sizes — normalise to GB
    if target_unit == "GB":
        if "TB" in text.upper():
            num = re.search(r'([\d.]+)', text)
            return float(num.group(1)) * 1024 if num else 0.0
        elif "MB" in text.upper():
            num = re.search(r'([\d.]+)', text)
            return float(num.group(1)) / 1024 if num else 0.0
        elif "KB" in text.upper():
            num = re.search(r'([\d.]+)', text)
            return float(num.group(1)) / (1024 * 1024) if num else 0.0
        else:
            num = re.search(r'([\d.]+)', text)
            return float(num.group(1)) if num else 0.0

    # Handle counts with K/M/B suffixes
    return _parse_value(text)


def _parse_value(text: str) -> float:
    """Parse a metric value string like '14,400s', '360 GB-Hrs', '1M', '2.5K' etc."""
    text = text.strip().replace(",", "")
    # Remove units suffix
    text = re.sub(r'\s*(seconds?|s|GB-Hrs?|GB|count|requests?|units?|invocations?)$', '', text, flags=re.IGNORECASE)
    text = text.strip()

    if not text or text == '-' or text == 'N/A':
        return 0.0

    # Handle K/M/B suffixes
    multiplier = 1
    if text.endswith('K') or text.endswith('k'):
        multiplier = 1_000
        text = text[:-1]
    elif text.endswith('M') or text.endswith('m'):
        multiplier = 1_000_000
        text = text[:-1]
    elif text.endswith('B') or text.endswith('b'):
        multiplier = 1_000_000_000
        text = text[:-1]

    try:
        return float(text) * multiplier
    except ValueError:
        return 0.0


def _parse_time_value(text: str) -> float:
    """Parse time values like '4h 0m', '23m 15s', '1h 30m 45s' to seconds."""
    text = text.strip()
    total = 0.0
    h = re.search(r'(\d+(?:\.\d+)?)\s*h', text, re.IGNORECASE)
    m = re.search(r'(\d+(?:\.\d+)?)\s*m(?!s)', text, re.IGNORECASE)
    s = re.search(r'(\d+(?:\.\d+)?)\s*s', text, re.IGNORECASE)
    if h:
        total += float(h.group(1)) * 3600
    if m:
        total += float(m.group(1)) * 60
    if s:
        total += float(s.group(1))
    return total if (h or m or s) else _parse_value(text)


def _scan_and_merge(body_text: str, seen: dict) -> None:
    """Scan body_text once, populate any newly-resolved metrics into `seen`.

    DOM layout (~Apr 2026):
       {Label} / (blank) / \\t / (blank) / {current_value} / / / {soft} / {hard}
    Labels may appear multiple times (nav, grid, tooltips); only the
    occurrence followed within ~8 lines by a digit-starting string is real.
    """
    lines = body_text.split("\n")
    for label, (db_key, unit) in METRIC_MAP.items():
        if db_key in seen:
            continue
        occurrences = [i for i, ln in enumerate(lines) if ln.strip() == label]
        for i in occurrences:
            raw = None
            for j in range(i + 1, min(i + 9, len(lines))):
                cand = lines[j].strip()
                if not cand or cand == "/":
                    continue
                if re.match(r"^\d", cand):
                    raw = cand
                break
            if raw is None:
                continue
            try:
                value = _convert_to_base_unit(raw, unit)
            except Exception:
                continue
            seen[db_key] = (value, raw, label)
            break


def scrape_vercel_usage() -> dict[str, float]:
    """Scrape the Vercel usage dashboard via Chrome CDP."""
    from playwright.sync_api import sync_playwright
    import socket

    # Check CDP is available
    try:
        with socket.create_connection(("127.0.0.1", 9222), timeout=2):
            pass
    except (ConnectionRefusedError, OSError):
        log.error("Chrome CDP not available on port 9222")
        return {}

    results = {}

    with sync_playwright() as p:
        try:
            browser = p.chromium.connect_over_cdp("http://127.0.0.1:9222")
            log.info("Connected to Chrome via CDP")
        except Exception as e:
            log.error("CDP connection failed: %s", e)
            return {}

        context = browser.contexts[0] if browser.contexts else browser.new_context()
        page = context.new_page()

        try:
            log.info("Navigating to %s", VERCEL_USAGE_URL)
            # Values are populated via async backend queries that return in
            # staggered chunks — any single snapshot captures only a subset.
            # Navigate once, then poll the DOM every 3s for up to 45s, merging
            # all metrics we see. Stop once we've seen all 15 METRIC_MAP entries
            # OR 45s elapses.
            page.goto(VERCEL_USAGE_URL, wait_until="networkidle", timeout=45000)

            # Poll the DOM in a loop, merging metric snapshots across attempts.
            # Each scan adds any newly-resolved metrics to `seen`; once a metric
            # is captured we keep the first numeric value (values don't change
            # mid-pageload).
            import time as _time
            deadline = _time.time() + 45
            seen: dict[str, tuple[float, str, str]] = {}  # db_key -> (value, raw, label)
            poll = 0
            while _time.time() < deadline and len(seen) < len(METRIC_MAP):
                poll += 1
                body_text = page.inner_text("body")
                before = len(seen)
                _scan_and_merge(body_text, seen)
                added = len(seen) - before
                log.info("  poll #%d: +%d → %d/%d metrics", poll, added, len(seen), len(METRIC_MAP))
                if len(seen) >= len(METRIC_MAP):
                    break
                _time.sleep(3)

            for db_key, (value, raw, label) in seen.items():
                results[db_key] = value
                log.info("  %s = %s (raw: '%s')", label, value, raw)

            log.info("Scraped %d metrics from Vercel dashboard", len(results))

        except Exception as e:
            log.error("Scraping failed: %s", e)
            # Take a screenshot for debugging
            try:
                screenshot_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "vercel-usage-debug.png")
                page.screenshot(path=screenshot_path, full_page=True)
                log.info("Debug screenshot saved to %s", screenshot_path)
            except Exception:
                pass
        finally:
            try:
                page.close()
            except Exception:
                pass
            browser.close()

    return results


def upsert_metrics(metrics: dict[str, float]) -> None:
    """Upsert scraped metrics to Supabase."""
    now = datetime.now().isoformat()
    rows = []

    for db_key, value in metrics.items():
        unit = next(
            (u for _, (k, u) in METRIC_MAP.items() if k == db_key),
            "unknown"
        )
        rows.append({
            "key": db_key,
            "value": str(value),
            "unit": unit,
            "scraped_at": now,
        })

    if not rows:
        log.warning("No metrics to upsert")
        return

    data = json.dumps(rows).encode()
    url = f"{SUPABASE_URL}/rest/v1/scraped_metrics"
    req = urllib.request.Request(url, data=data, headers=HEADERS, method="POST")
    try:
        with urllib.request.urlopen(req) as resp:
            resp.read()
        log.info("Upserted %d metrics to scraped_metrics", len(rows))
    except Exception as e:
        log.error("Failed to upsert metrics: %s", e)


def _hadley_auth_key() -> str:
    """HADLEY_AUTH_KEY from env or the discord-messenger .env (Task
    Scheduler runs without the interactive environment)."""
    key = os.environ.get("HADLEY_AUTH_KEY", "")
    if key:
        return key
    dm_env = os.path.join(os.path.expanduser("~"), "claude-projects",
                          "discord-messenger", ".env")
    if os.path.exists(dm_env):
        with open(dm_env) as f:
            for line in f:
                if line.startswith("HADLEY_AUTH_KEY="):
                    return line.split("=", 1)[1].strip()
    return ""


def main():
    log.info("=== Vercel Usage Scraper Starting ===")

    metrics = scrape_vercel_usage()

    if metrics:
        upsert_metrics(metrics)
    else:
        # Fail LOUDLY: a warning + exit 0 hid an expired Vercel session for
        # 3 weeks (22 May - 12 Jun 2026) while the usage report ran on stale
        # data. Alert #alerts (throttled) and give Task Scheduler a real
        # failure code.
        log.error("No metrics scraped — Vercel login likely expired (run scripts/login_vercel.py)")
        try:
            req = urllib.request.Request(
                "http://localhost:8100/alert",
                data=json.dumps({
                    "message": "Vercel usage scraper got no metrics — Vercel session "
                               "likely expired. Run scripts/login_vercel.py in the HB repo.",
                    "source": "vercel-scraper",
                    "throttle_minutes": 720,
                }).encode(),
                headers={"Content-Type": "application/json",
                         "x-api-key": _hadley_auth_key()},
                method="POST",
            )
            urllib.request.urlopen(req, timeout=10)
        except Exception as e:
            log.warning("alert post failed: %s", e)
        sys.exit(1)

    log.info("=== Vercel Usage Scraper Complete ===")


if __name__ == "__main__":
    main()
