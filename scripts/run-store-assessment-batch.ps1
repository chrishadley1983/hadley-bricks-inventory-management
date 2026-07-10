# Store Assessment Nightly Sweep Runner
#
# Runs the BL store-assessment batch CLI: picks the stalest enabled
# store_assessment_watchlist entries, re-assesses each store from the caches
# (one polite CDP scrape per store), and Discord-alerts BUY verdicts / material
# deltas. See apps/web/scripts/store-assessment-batch.ts.
#
# Scheduled nightly via register-store-assessment-batch-task.ps1.
# Requires the dedicated CDP Chrome on :9222 (C:\chrome-cdp\launch-cdp-chrome.bat,
# logged in to BrickLink).

$ErrorActionPreference = "Stop"

$webDir = Join-Path $PSScriptRoot "..\apps\web"
Set-Location $webDir

$log = Join-Path $PSScriptRoot "..\tmp\store-assessment-batch-last-run.log"
"=== sweep started $(Get-Date -Format o) ===" | Out-File -FilePath $log -Encoding utf8

npx tsx scripts/store-assessment-batch.ts --budget=25 --min-age-days=5 2>&1 |
    Tee-Object -FilePath $log -Append

"=== sweep finished $(Get-Date -Format o) (exit $LASTEXITCODE) ===" | Out-File -FilePath $log -Append -Encoding utf8
exit $LASTEXITCODE
