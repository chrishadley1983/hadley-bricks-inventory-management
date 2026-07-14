# Throttled runner for the brickset_sets identity enrichment (Keepa barcode → ASIN).
# Keepa's token bucket only allows ~2,000 lookups before refill-throttling, so this
# runs a capped burst; the script exits cleanly on token exhaustion or when no eligible
# sets remain, so repeated invocations complete the catch-up over successive refill
# windows. Auto-created 2026-07-13; delete the scheduled task once coverage plateaus.
$ErrorActionPreference = 'Continue'
$webDir = 'C:\Users\Chris Hadley\claude-projects\hadley-bricks-inventory-management\apps\web'
$logDir = Join-Path $webDir 'logs\enrich-identity'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$log = Join-Path $logDir ("enrich-" + (Get-Date -Format 'yyyyMMdd') + ".log")
Set-Location $webDir
"[run-enrich-identity] $(Get-Date -Format o) starting burst" | Tee-Object -FilePath $log -Append
& npx tsx scripts/enrich-brickset-identity.ts --max-tokens=1800 2>&1 | Tee-Object -FilePath $log -Append
"[run-enrich-identity] $(Get-Date -Format o) burst finished exit=$LASTEXITCODE" | Tee-Object -FilePath $log -Append
