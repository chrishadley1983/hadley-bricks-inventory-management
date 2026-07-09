# pg-refresh-cycle.ps1 — nightly runner for the lane D (catalogPG) active-cycle refresh
# (invoked by Windows Task Scheduler, see register-pg-tasks.ps1).
#
# HARD CONSTRAINT (done-criteria F3): this is LOCAL-ONLY. It drives the domham91 CDP
# Chrome (port 9222, GBP display) through six ~350-page sessions with 20-min breathers
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

$cdpPort = 9222
try {
    $resp = Invoke-WebRequest -Uri "http://127.0.0.1:$cdpPort/json/version" -TimeoutSec 3 -UseBasicParsing
    if ($resp.StatusCode -ne 200) { throw "unexpected status $($resp.StatusCode)" }
} catch {
    Write-Output "[pg-refresh-cycle.ps1] $(Get-Date -Format o) CDP not reachable on port $cdpPort ($($_.Exception.Message)) - skipping run." | Tee-Object -FilePath $log -Append
    exit 0
}

# npx tsx runs the TypeScript job directly; all output is teed to the daily log.
# npx writes a benign "npm warn config ignoring workspace config at .../.npmrc" line to
# stderr on every call; under ErrorActionPreference=Stop that stderr write is promoted to a
# terminating error and kills the runner BEFORE tsx runs (empty log after "starting",
# exit 1, no telemetry). Drop to Continue around the native call — $LASTEXITCODE is the
# real pass/fail signal.
$ErrorActionPreference = 'Continue'
& npx tsx scripts/pg/pg-refresh-cycle.ts 2>&1 | Tee-Object -FilePath $log -Append
$code = $LASTEXITCODE
Write-Output "[pg-refresh-cycle.ps1] $(Get-Date -Format o) finished exit=$code" | Tee-Object -FilePath $log -Append
exit $code
