# pg-heartbeat.ps1 — daily runner for the lane-D refresh dead-man's switch (invoked by
# Windows Task Scheduler, see register-pg-tasks.ps1).
#
# Reads bl_pg_lane_telemetry and posts a Discord alert if no productive nightly lane-D
# refresh has landed within the freshness window. No CDP/BrickLink — read-only Supabase +
# Discord — so it stays up even when the refresh it watches is down. LOCAL-ONLY, never Vercel.
#
# Runs AFTER the refresh window (00:05 + 7h30m = 07:35) so an in-progress run can't false-alarm.
#
# Register once with register-pg-tasks.ps1, or run by hand:
#   powershell -ExecutionPolicy Bypass -File apps\web\scripts\pg\pg-heartbeat.ps1
$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Parent $PSCommandPath
$webDir = Split-Path -Parent (Split-Path -Parent $scriptDir)
$logDir = Join-Path $webDir 'logs\pg-heartbeat'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd'
$log = Join-Path $logDir "heartbeat-$stamp.log"

Set-Location $webDir
Write-Output "[pg-heartbeat.ps1] $(Get-Date -Format o) starting (cwd=$webDir)" | Tee-Object -FilePath $log -Append

# npx's "npm warn config ignoring workspace config" stderr line would abort the runner
# under ErrorActionPreference=Stop before tsx runs — drop to Continue; $LASTEXITCODE is
# the real pass/fail signal.
$ErrorActionPreference = 'Continue'
& npx tsx scripts/pg/pg-refresh-heartbeat.ts 2>&1 | Tee-Object -FilePath $log -Append
$code = $LASTEXITCODE
Write-Output "[pg-heartbeat.ps1] $(Get-Date -Format o) finished exit=$code" | Tee-Object -FilePath $log -Append
exit $code
