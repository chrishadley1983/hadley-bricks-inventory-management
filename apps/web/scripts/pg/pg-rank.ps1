# pg-rank.ps1 — monthly ranking-cut recompute (invoked DAILY by Windows Task Scheduler;
# self-exits unless it's the 1st of the month — simpler than a true monthly trigger).
#
# No CDP/Chrome dependency: pg-rank.ts only reads/writes Supabase. LOCAL-ONLY per
# done-criteria F3 anyway (no exec_sql/RPC available for a server-side job, and the
# repo's hard scheduling constraint keeps all pg-* jobs off Vercel regardless).
#
# Register once with register-pg-tasks.ps1, or run by hand:
#   powershell -ExecutionPolicy Bypass -File apps\web\scripts\pg\pg-rank.ps1
$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Parent $PSCommandPath
$webDir = Split-Path -Parent (Split-Path -Parent $scriptDir)
$logDir = Join-Path $webDir 'logs\pg-rank'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd'
$log = Join-Path $logDir "rank-$stamp.log"

Set-Location $webDir

if ((Get-Date).Day -ne 1) {
    Write-Output "[pg-rank.ps1] $(Get-Date -Format o) not day 1 of the month - skipping (monthly job on a daily trigger)." | Tee-Object -FilePath $log -Append
    exit 0
}

Write-Output "[pg-rank.ps1] $(Get-Date -Format o) starting monthly ranking-cut recompute (cwd=$webDir)" | Tee-Object -FilePath $log -Append
& npx tsx scripts/pg/pg-rank.ts 2>&1 | Tee-Object -FilePath $log -Append
$code = $LASTEXITCODE
Write-Output "[pg-rank.ps1] $(Get-Date -Format o) finished exit=$code" | Tee-Object -FilePath $log -Append
exit $code
