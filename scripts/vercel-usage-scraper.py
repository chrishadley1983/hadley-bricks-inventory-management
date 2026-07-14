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


def relaunch_chrome_vinted(port: int = 9222) -> bool:
    """Kill a wedged CDP Chrome-Vinted and relaunch it headless. Returns readiness.

    The Chrome-Vinted instance is shared (flight scraper, Vinted automation, this
    scraper). When it wedges — leaked tabs degrade it until connect_over_cdp
    hangs (2026-06-22) — every CDP scraper on :9222 fails at once. ensure-style
    checks see the port answering and won't relaunch, so recovery needs an
    explicit kill. Cookies live on disk so the Vercel/Vinted sessions survive.
    """
    import socket
    import subprocess
    # Kill ONLY the Chrome-Vinted instance: match port AND user-data-dir. A port-only
    # match killed whatever Chrome held :9222 — including the BrickLink Chrome when the
    # two fought over the port (root cause of the 2026-07-14 audit's poisoned-Chrome
    # incidents). BL Chrome now lives on :9225, but keep the kill scoped regardless.
    ps = (
        "Get-CimInstance Win32_Process -Filter \"Name='chrome.exe'\" | "
        f"Where-Object {{ $_.CommandLine -match 'remote-debugging-port={port}' -and "
        "$_.CommandLine -match 'Chrome-Vinted' } | "
        "ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue } catch {} }"
    )
    try:
        subprocess.run(["powershell", "-NoProfile", "-Command", ps],
                       capture_output=True, text=True, timeout=30)
    except Exception as e:
        log.warning("relaunch kill step failed: %s", e)
    time.sleep(2)
    # HEADED relaunch: --headless=new poisons the shared Chrome-Vinted for every other
    # consumer (Vinted review-queue / BL listing get 403'd headless). Headed still works
    # from a scheduled task; if the desktop session is locked the window is just invisible.
    subprocess.Popen([
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        f"--remote-debugging-port={port}",
        r"--user-data-dir=C:\Users\Chris Hadley\AppData\Local\Google\Chrome-Vinted",
        "--no-first-run",
        "--no-default-browser-check", "about:blank",
    ])
    for _ in range(30):
        time.sleep(1)
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=1):
                return True
        except OSError:
            continue
    return False


def scrape_vercel_usage() -> tuple[dict[str, float], str]:
    """Scrape the Vercel usage dashboard via Chrome CDP.

    Returns (metrics, status). status is one of:
      ok            — metrics scraped
      login_required— dashboard redirected to a Vercel login/SSO page (re-login)
      cdp_failed    — couldn't connect to / launch the CDP Chrome (likely wedged)
      no_data       — connected & on the dashboard but 0 metrics parsed
    Distinguishing these stops the scraper crying "session expired" (the old
    behaviour) when the real cause is a wedged Chrome — which a relaunch fixes.
    """
    from playwright.sync_api import sync_playwright
    import socket

    # Check CDP is available; auto-launch Chrome-Vinted headless if not
    # (the 06:30 scheduled run can't rely on Chrome already being up —
    # this gap contributed to the silent 3-week outage to 12 Jun 2026).
    try:
        with socket.create_connection(("127.0.0.1", 9222), timeout=2):
            pass
    except (ConnectionRefusedError, OSError):
        log.info("Chrome CDP not running — launching Chrome-Vinted (headed; headless breaks the shared instance)")
        import subprocess
        subprocess.Popen([
            r"C:\Program Files\Google\Chrome\Application\chrome.exe",
            "--remote-debugging-port=9222",
            r"--user-data-dir=C:\Users\Chris Hadley\AppData\Local\Google\Chrome-Vinted",
            "--no-first-run",
            "--no-default-browser-check", "about:blank",
        ])
        for _ in range(15):
            time.sleep(1)
            try:
                with socket.create_connection(("127.0.0.1", 9222), timeout=1):
                    break
            except OSError:
                continue
        else:
            log.error("Chrome CDP not available on port 9222 after launch attempt")
            return {}, "cdp_failed"

    results = {}

    with sync_playwright() as p:
        try:
            browser = p.chromium.connect_over_cdp("http://127.0.0.1:9222")
            log.info("Connected to Chrome via CDP")
        except Exception as e:
            log.error("CDP connection failed: %s", e)
            return {}, "cdp_failed"

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

            # If the profile's Vercel session has genuinely expired, the
            # dashboard redirects to a login/SSO page. Detect that explicitly so
            # we only report "re-login needed" when it's true — a wedged CDP
            # Chrome also yields 0 metrics but is fixed by a relaunch, not a
            # login (the misdiagnosis behind the 2026-06-22 false alert).
            cur_url = (page.url or "").lower()
            if "/login" in cur_url or "/sso" in cur_url or "/auth" in cur_url:
                log.error("Vercel dashboard redirected to login (%s) — session expired", page.url)
                return {}, "login_required"

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

    return results, ("ok" if results else "no_data")


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

    # Also append to vercel_usage_history (one row per key per day) — the
    # scraped_metrics PK is `key` so it overwrites, leaving no history for
    # the report's trend/projection. PK there is (key, scrape_date) so this
    # is idempotent within a day and accumulates across days.
    today = datetime.now().strftime("%Y-%m-%d")
    hist_rows = [{"key": r["key"], "scrape_date": today,
                  "value": r["value"], "unit": r["unit"],
                  "scraped_at": now} for r in rows]
    hist_req = urllib.request.Request(
        f"{SUPABASE_URL}/rest/v1/vercel_usage_history",
        data=json.dumps(hist_rows).encode(), headers=HEADERS, method="POST")
    try:
        with urllib.request.urlopen(hist_req) as resp:
            resp.read()
        log.info("Appended %d metrics to vercel_usage_history", len(hist_rows))
    except Exception as e:
        log.error("Failed to append usage history: %s", e)


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


def _alert(message: str) -> None:
    """Throttled #alerts post via Hadley API (best-effort)."""
    try:
        req = urllib.request.Request(
            "http://localhost:8100/alert",
            data=json.dumps({
                "message": message,
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


def main():
    log.info("=== Vercel Usage Scraper Starting ===")

    metrics, status = scrape_vercel_usage()

    # Self-heal the most common failure: a wedged shared Chrome-Vinted (cdp_failed
    # / no_data while still logged in). Relaunch a fresh Chrome and retry ONCE
    # before alerting — this is what actually broke on 2026-06-22, and it does
    # NOT need a human. Only a real login redirect needs Chris.
    if not metrics and status in ("cdp_failed", "no_data"):
        log.warning("No metrics (status=%s) — relaunching Chrome-Vinted and retrying once", status)
        if relaunch_chrome_vinted():
            metrics, status = scrape_vercel_usage()

    if metrics:
        upsert_metrics(metrics)
        log.info("=== Vercel Usage Scraper Complete ===")
        return

    # Still no metrics after self-heal. Fail LOUDLY (a warning + exit 0 once hid
    # an expired session for 3 weeks) but report the ACCURATE cause so the alert
    # doesn't cry "re-login" when a relaunch is what's needed.
    if status == "login_required":
        log.error("Vercel session expired — run scripts/login_vercel.py")
        _alert("Vercel usage scraper: the dashboard redirected to login — the "
               "session has genuinely expired. Run `python scripts/login_vercel.py` "
               "in the HB repo to re-authenticate.")
    else:
        log.error("No metrics scraped (status=%s) after Chrome relaunch — "
                  "CDP/selector issue, NOT necessarily a login expiry", status)
        _alert(f"Vercel usage scraper got no metrics (status={status}) even after "
               "relaunching Chrome — likely a wedged CDP Chrome or dashboard "
               "selector drift, not a login expiry. Check Chrome-Vinted on :9222.")
    sys.exit(1)


if __name__ == "__main__":
    main()
