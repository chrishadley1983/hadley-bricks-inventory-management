# pov-refresh.ps1 — daily runner for the POV freshness top-up (invoked by Windows Task Scheduler).
#
# Re-scrapes the most-overdue stale POV cache rows (up to the daily budget) so the dataset never
# goes stale. Needs the dedicated CDP Chrome (:9222) up, logged in as domham91 (USD display),
# behind the VPN — same prerequisites as the backfill. If Chrome is down the job records a
# stopped-early run and the Discord report flags it.
#
# Register once with register-pov-refresh-task.ps1, or run by hand:
#   powershell -ExecutionPolicy Bypass -File apps\web\scripts\pov-refresh.ps1
$ErrorActionPreference = 'Stop'

# apps/web is two levels up from this script (apps/web/scripts/pov-refresh.ps1).
$webDir = Split-Path -Parent (Split-Path -Parent $PSCommandPath)
$logDir = Join-Path $webDir '..\..\tmp\pov-backfill'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd'
$log = Join-Path $logDir "refresh-$stamp.log"

Set-Location $webDir
Write-Output "[pov-refresh.ps1] $(Get-Date -Format o) starting (cwd=$webDir)" | Tee-Object -FilePath $log -Append
# npx tsx runs the TypeScript job directly; all output is teed to the daily log.
& npx tsx scripts/pov-refresh.ts 2>&1 | Tee-Object -FilePath $log -Append
$code = $LASTEXITCODE
Write-Output "[pov-refresh.ps1] $(Get-Date -Format o) finished exit=$code" | Tee-Object -FilePath $log -Append
exit $code
