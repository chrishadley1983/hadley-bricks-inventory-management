"""Launch Chrome-Vinted headed so Chris can sign into Vercel.

The vercel-usage-scraper.py uses Chrome-Vinted on CDP port 9222 to scrape the
Vercel dashboard. The profile's Vercel session expired on ~28 Mar 2026 and has
been silently failing since. This helper:

  1. Kills the current headless Chrome-Vinted
  2. Launches a visible Chrome-Vinted on the same profile + port, navigated
     to https://vercel.com/login
  3. Waits for you to sign in (prompts Enter when the /usage page is loaded)
  4. Verifies via CDP that the logged-in Vercel dashboard is actually reachable
  5. Closes the headed Chrome and relaunches it headless on port 9222
  6. Runs vercel-usage-scraper.py once to confirm metrics now populate

Run:
    python scripts/login_vercel.py
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

CHROME_EXE = os.path.join(
    os.getenv("PROGRAMFILES", r"C:\Program Files"),
    "Google", "Chrome", "Application", "chrome.exe",
)
USER_DATA_DIR = os.path.join(
    os.getenv("LOCALAPPDATA", ""),
    "Google", "Chrome-Vinted",
)
CDP_PORT = 9222
LOGIN_URL = "https://vercel.com/login"
USAGE_URL = "https://vercel.com/chrishadley1983s-projects/~/usage"

SCRIPT_DIR = Path(__file__).resolve().parent


def _cdp_alive() -> bool:
    try:
        with urllib.request.urlopen(f"http://localhost:{CDP_PORT}/json/version", timeout=2):
            return True
    except Exception:
        return False


def _cdp_tabs() -> list[dict]:
    try:
        with urllib.request.urlopen(f"http://localhost:{CDP_PORT}/json", timeout=3) as r:
            return json.loads(r.read())
    except Exception:
        return []


def _is_admin() -> bool:
    """True if the current process has admin privileges."""
    try:
        import ctypes
        return bool(ctypes.windll.shell32.IsUserAnAdmin())
    except Exception:
        return False


def _session0_pid_on_9222() -> int | None:
    """If port 9222 is owned by a Session 0 process, return its PID; else None.
    Session 0 = the non-interactive services session. We can't kill into it from
    a normal user shell — requires admin.
    """
    ps = r"""
$port = Get-NetTCPConnection -LocalPort 9222 -State Listen -ErrorAction SilentlyContinue
if (-not $port) { return }
$p = Get-CimInstance Win32_Process -Filter ("ProcessId=" + $port.OwningProcess)
if (-not $p) { return }
# Query the session id via Get-Process (works even when CommandLine is empty)
$proc = Get-Process -Id $p.ProcessId -ErrorAction SilentlyContinue
if ($proc) { "$($p.ProcessId)|$($proc.SessionId)" }
"""
    r = subprocess.run(
        ["powershell", "-NoProfile", "-Command", ps],
        capture_output=True, text=True, timeout=10,
    )
    out = r.stdout.strip()
    if "|" in out:
        pid_s, sess_s = out.split("|", 1)
        if sess_s.strip() == "0":
            return int(pid_s)
    return None


def _kill_chrome_vinted() -> int:
    """Kill all chrome.exe processes bound to CDP port 9222 and the Chrome-Vinted profile.

    Approach:
      1. Find the PID owning port 9222 (authoritative — this is the browser master).
      2. Walk the chrome.exe tree: kill anything whose ancestor is that PID, plus
         anything whose CommandLine contains 'Chrome-Vinted' (covers edge cases).
      3. Retry loop: after kill, port should free within a few seconds.
    """
    ps_script = r"""
$port = Get-NetTCPConnection -LocalPort 9222 -State Listen -ErrorAction SilentlyContinue
$rootPid = if ($port) { $port.OwningProcess } else { $null }
$chromeProcs = Get-CimInstance Win32_Process -Filter "Name='chrome.exe'"
$targets = @{}
if ($rootPid) { $targets[$rootPid] = $true }
foreach ($p in $chromeProcs) {
  if ($p.CommandLine -and $p.CommandLine -like '*Chrome-Vinted*') { $targets[$p.ProcessId] = $true }
  if ($rootPid -and $p.ParentProcessId -eq $rootPid) { $targets[$p.ProcessId] = $true }
}
# Also sweep any chrome.exe whose ancestor chain includes rootPid
if ($rootPid) {
  $changed = $true
  while ($changed) {
    $changed = $false
    foreach ($p in $chromeProcs) {
      if (-not $targets.ContainsKey($p.ProcessId) -and $targets.ContainsKey($p.ParentProcessId)) {
        $targets[$p.ProcessId] = $true
        $changed = $true
      }
    }
  }
}
foreach ($tpid in $targets.Keys) {
  Stop-Process -Id $tpid -Force -ErrorAction SilentlyContinue
  Write-Output $tpid
}
"""
    result = subprocess.run(
        ["powershell", "-NoProfile", "-Command", ps_script],
        capture_output=True, text=True, timeout=30,
    )
    pids = [p.strip() for p in result.stdout.splitlines() if p.strip().isdigit()]
    if pids:
        print(f"Killed {len(pids)} chrome.exe process(es): {','.join(pids)}")
    # Give OS time to release the profile lock + port
    for _ in range(20):
        if not _cdp_alive():
            break
        time.sleep(1)
    return len(pids)


def _launch_chrome(*, headless: bool, url: str = "about:blank") -> subprocess.Popen:
    args = [
        CHROME_EXE,
        f"--remote-debugging-port={CDP_PORT}",
        f"--user-data-dir={USER_DATA_DIR}",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-session-crashed-bubble",
        "--disable-features=RendererCodeIntegrity",
        url,
    ]
    if headless:
        args.insert(-1, "--headless=new")
        args.insert(-1, "--disable-gpu")
    creationflags = subprocess.CREATE_NO_WINDOW if headless and sys.platform == "win32" else 0
    proc = subprocess.Popen(args, creationflags=creationflags)
    # Wait for CDP to come up
    for _ in range(30):
        if _cdp_alive():
            return proc
        time.sleep(0.5)
    raise RuntimeError(f"Chrome CDP didn't bind to port {CDP_PORT} within 15s")


def _current_page_url() -> str:
    """Return the URL of any visible page tab via CDP (read-only — works on modern Chrome)."""
    for tab in _cdp_tabs():
        if tab.get("type") == "page" and tab.get("url", "").startswith("http"):
            return tab["url"]
    return ""


def main() -> int:
    print("=" * 60)
    print("Vercel login helper (Chrome-Vinted / CDP port 9222)")
    print("=" * 60)

    # 1. Kill existing Chrome-Vinted
    print("\n[1/5] Killing existing Chrome-Vinted…")
    session0_pid = _session0_pid_on_9222()
    if session0_pid and not _is_admin():
        print(f"\n    ✗ Chrome-Vinted (PID {session0_pid}) is running in Session 0 (services session).")
        print("      A normal user shell cannot kill Session 0 processes.")
        print("      RELAUNCH this script from an ELEVATED PowerShell:")
        print("        1. Close this window")
        print("        2. Start → search 'PowerShell' → right-click → 'Run as administrator'")
        print("        3. cd 'C:\\Users\\Chris Hadley\\claude-projects\\hadley-bricks-inventory-management'")
        print("        4. python scripts\\login_vercel.py")
        return 10
    _kill_chrome_vinted()
    if _cdp_alive():
        print("\n    ✗ CDP still reachable after kill — profile lock stuck.")
        print("      Wait 10s and try again, or reboot Chrome-Vinted-holding services.")
        return 11

    # 2. Launch headed
    print("\n[2/5] Launching Chrome-Vinted (VISIBLE) on Vercel login page…")
    headed = _launch_chrome(headless=False, url=LOGIN_URL)
    print(f"    PID {headed.pid} — a Chrome window should appear shortly.")

    # 3. Wait for manual login
    print("\n[3/5] ACTION REQUIRED:")
    print("      • Sign in to Vercel in the Chrome window that just opened.")
    print("      • Use the same account you use normally (Google/GitHub).")
    print("      • Once signed in, navigate to the Usage page (link inside Vercel).")
    print(f"      • Or just open: {USAGE_URL}")
    input("\n      Press ENTER here when you're on the Usage page…")

    # 4. Quick sanity check (read-only CDP — just peek at the current tab URL)
    print("\n[4/5] Sanity check via CDP…")
    url = _current_page_url()
    if not url:
        print("    ⚠ No open page tab detected in CDP. Continuing anyway.")
    elif "/login" in url.lower():
        print(f"    ⚠ Still on a login page ({url}). Session may not have persisted.")
        print("    Sign in again in the Chrome window, then press Enter when done.")
        input("    Press ENTER when on the Usage dashboard…")
    else:
        print(f"    ✓ CDP sees: {url}")

    # 5. Swap to headless and run scraper
    print("\n[5/5] Closing headed Chrome, relaunching headless, running scraper…")
    _kill_chrome_vinted()
    _launch_chrome(headless=True, url="about:blank")
    time.sleep(2)

    scraper = SCRIPT_DIR / "vercel-usage-scraper.py"
    result = subprocess.run(
        [sys.executable, str(scraper)],
        capture_output=True, text=True, timeout=120,
    )
    tail = "\n".join((result.stdout + result.stderr).splitlines()[-15:])
    print(tail)
    if "Scraped 0 metrics" in result.stdout + result.stderr:
        print("\n⚠ Scraper still returned 0 metrics. Check the dashboard URL & selectors.")
        return 3

    print("\n✓ All done. The vercel-usage-scraper should now work on schedule (06:30 daily).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
