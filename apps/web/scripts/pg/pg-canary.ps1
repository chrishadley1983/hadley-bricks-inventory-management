# pg-canary.ps1 — daily runner for the PG golden-tuple canary (invoked by Windows Task
# Scheduler, see register-pg-tasks.ps1).
#
# Runs all three lanes daily: anon-curl unconditionally, catalogPG via the domham91
# CDP Chrome (--cdp, usually still live shortly after the nightly refresh cycle), and
# the BL store API (--api) — the golden set costs ~20 store-API calls/day, well inside
# the budget gate, and spec §4.4 wants every active lane compared daily.
#
# LOCAL-ONLY, same constraint as pg-refresh-cycle.ps1 — must never become a Vercel cron.
#
# Register once with register-pg-tasks.ps1, or run by hand:
#   powershell -ExecutionPolicy Bypass -File apps\web\scripts\pg\pg-canary.ps1
$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Parent $PSCommandPath
$webDir = Split-Path -Parent (Split-Path -Parent $scriptDir)
$logDir = Join-Path $webDir 'logs\pg-canary'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd'
$log = Join-Path $logDir "canary-$stamp.log"

Set-Location $webDir
Write-Output "[pg-canary.ps1] $(Get-Date -Format o) starting (cwd=$webDir)" | Tee-Object -FilePath $log -Append

# --api included so all three lanes are compared daily (spec §4.4 "every active
# lane"); the golden set costs ~20 store-API calls/day, well inside the budget gate.
# npx's "npm warn config ignoring workspace config" stderr line would abort the runner
# under ErrorActionPreference=Stop before tsx runs — drop to Continue; $LASTEXITCODE is
# the real pass/fail signal.
$ErrorActionPreference = 'Continue'
& npx tsx scripts/pg/pg-canary.ts --cdp --api 2>&1 | Tee-Object -FilePath $log -Append
$code = $LASTEXITCODE
Write-Output "[pg-canary.ps1] $(Get-Date -Format o) finished exit=$code" | Tee-Object -FilePath $log -Append
exit $code
