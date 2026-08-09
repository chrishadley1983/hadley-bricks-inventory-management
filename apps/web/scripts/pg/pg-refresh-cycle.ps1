# pg-refresh-cycle.ps1 - nightly runner for the lane D (catalogPG) active-cycle refresh
# (invoked by Windows Task Scheduler, see register-pg-tasks.ps1).
#
# HARD CONSTRAINT (done-criteria F3): this is LOCAL-ONLY. It drives the domham91 CDP
# Chrome (port 9225, GBP display) through six ~350-page sessions with 20-min breathers
# over a ~7.5h window. It must never become a Vercel cron/route.
#
# Prerequisite: the dedicated domham91 CDP Chrome profile must be running and logged in.
# This wrapper pre-checks CDP reachability and exits cleanly (code 0) if it's down, so a
# missed night just shows up as a gap in bl_pg_lane_telemetry rather than a scheduler
# failure notification.
#
# Register once with register-pg-tasks.ps1, or run by hand:
#   powershell -ExecutionPolicy Bypass -File apps\web\scripts\pg\pg-refresh-cycle.ps1
$ErrorActionPreference = 'Stop'

# apps/web is three levels up from this script (apps/web/scripts/pg/pg-refresh-cycle.ps1).
$scriptDir = Split-Path -Parent $PSCommandPath
$webDir = Split-Path -Parent (Split-Path -Parent $scriptDir)
$logDir = Join-Path $webDir 'logs\pg-refresh'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd'
$log = Join-Path $logDir "refresh-$stamp.log"

Set-Location $webDir
Write-Output "[pg-refresh-cycle.ps1] $(Get-Date -Format o) starting (cwd=$webDir)" | Tee-Object -FilePath $log -Append

$cdpPort = 9225
# Self-heal (2026-08-09): this used to be a bare pre-check that exited 0 when Chrome was
# down, so a browser crash silently cost every run until a human noticed - it cost ~2,700
# tuples and a nightly window on 08-08/08-09. Now: try to bring Chrome back, and only skip
# (with a Discord alert) if that genuinely fails. See ensure-cdp-chrome.ps1 for why it
# spawns Chrome detached rather than as a child of this script.
$ErrorActionPreference = 'Continue'
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $scriptDir 'ensure-cdp-chrome.ps1') -Port $cdpPort 2>&1 |
    Tee-Object -FilePath $log -Append
$cdpOk = ($LASTEXITCODE -eq 0)
$ErrorActionPreference = 'Stop'

if (-not $cdpOk) {
    Write-Output "[pg-refresh-cycle.ps1] $(Get-Date -Format o) CDP unrecoverable on port $cdpPort - skipping run." | Tee-Object -FilePath $log -Append
    # Alert, because a silent skip is what let the 08-08 outage run overnight unnoticed.
    $ErrorActionPreference = 'Continue'
    & npx tsx scripts/pg/pg-cdp-alert.ts `
        "lane D skipped - CDP Chrome unrecoverable" `
        "The nightly refresh could not start: Chrome on port $cdpPort is down and could not be relaunched." `
        "Auto-relaunch was attempted (ensure-cdp-chrome.ps1) and failed - a profile lock, a crashed-profile restore prompt, or a Chrome update usually explains it." `
        "Until it is back, every lane D run is a no-op. Check C:\chrome-cdp and relaunch with launch-cdp-chrome.bat." 2>&1 |
        Tee-Object -FilePath $log -Append
    Write-Output "[pg-refresh-cycle.ps1] $(Get-Date -Format o) finished exit=0 (skipped)" | Tee-Object -FilePath $log -Append
    exit 0
}

# npx tsx runs the TypeScript job directly; all output is teed to the daily log.
# npx writes a benign "npm warn config ignoring workspace config at .../.npmrc" line to
# stderr on every call; under ErrorActionPreference=Stop that stderr write is promoted to a
# terminating error and kills the runner BEFORE tsx runs (empty log after "starting",
# exit 1, no telemetry). Drop to Continue around the native call - $LASTEXITCODE is the
# real pass/fail signal.
$ErrorActionPreference = 'Continue'
# TRIAL (Chris 2026-07-13): 5-min block backoff AND 5-min breather (down from 20) - testing
# whether BL throttling is purely per-request-rate. Breather is the bigger risk (it's what
# breaks up the sustained-crawl fingerprint) - revert breather-mins first if blocks rise.
& npx tsx scripts/pg/pg-refresh-cycle.ts --backoff-mins=5 --breather-mins=5 2>&1 | Tee-Object -FilePath $log -Append
$code = $LASTEXITCODE

# Post-step (intl-set-arb F3): re-flag arbitrage candidates from tonight's fresh
# offers. Cache-only (no CDP, no BL calls) - a failure here must not fail the
# refresh run; it just means candidates lag a night.
Write-Output "[pg-refresh-cycle.ps1] $(Get-Date -Format o) refreshing intl set-arb candidates..." | Tee-Object -FilePath $log -Append
& npx tsx scripts/intl-arb/refresh-candidates.ts 2>&1 | Tee-Object -FilePath $log -Append
Write-Output "[pg-refresh-cycle.ps1] $(Get-Date -Format o) candidates refresh exit=$LASTEXITCODE" | Tee-Object -FilePath $log -Append

Write-Output "[pg-refresh-cycle.ps1] $(Get-Date -Format o) finished exit=$code" | Tee-Object -FilePath $log -Append
exit $code
