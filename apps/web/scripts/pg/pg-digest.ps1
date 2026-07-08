# pg-digest.ps1 - weekly runner for the PG market intelligence digest (invoked by Windows
# Task Scheduler, see register-pg-tasks.ps1). Mirrors pg-canary.ps1's log-and-exit shape.
#
# Composes STR risers/fallers, fig-radar movers, coverage/freshness health, and the most
# recent own-store-audit report (last 7 days) into a markdown file + a Discord post.
#
# LOCAL-ONLY, same constraint as the other pg/*.ps1 runners - must never become a Vercel
# cron.
#
# Register once with register-pg-tasks.ps1, or run by hand:
#   powershell -ExecutionPolicy Bypass -File apps\web\scripts\pg\pg-digest.ps1
$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Parent $PSCommandPath
$webDir = Split-Path -Parent (Split-Path -Parent $scriptDir)
$logDir = Join-Path $webDir 'logs\pg-digest'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd'
$log = Join-Path $logDir "digest-$stamp.log"

Set-Location $webDir
Write-Output "[pg-digest.ps1] $(Get-Date -Format o) starting (cwd=$webDir)" | Tee-Object -FilePath $log -Append

& npx tsx scripts/pg/pg-digest.ts 2>&1 | Tee-Object -FilePath $log -Append
$code = $LASTEXITCODE
Write-Output "[pg-digest.ps1] $(Get-Date -Format o) finished exit=$code" | Tee-Object -FilePath $log -Append
exit $code
