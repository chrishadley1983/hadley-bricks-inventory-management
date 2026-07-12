# Store Assessment Nightly Sweep Runner
#
# Runs the BL store-assessment batch CLI: picks the stalest enabled
# store_assessment_watchlist entries, re-assesses each store from the caches
# (one polite CDP scrape per store), and Discord-alerts BUY verdicts / material
# deltas. See apps/web/scripts/store-assessment-batch.ts.
#
# DEPLOYMENT: the scheduled task points at the copy of this script inside the
# DEDICATED worktree C:\Users\Chris Hadley\claude-projects\hb-assess-wt, which is
# pinned to origin/main and self-updates below. The main repo checkout can't be
# used — Claude sessions constantly switch its branch, so repo files may be
# absent at 02:15. (Same reason hb-dashboard-wt exists.) node_modules are
# junctioned from the main checkout; apps/web/.env.local is a manual copy —
# refresh it if secrets rotate.
#
# Scheduled nightly via register-store-assessment-batch-task.ps1.
# Requires the dedicated CDP Chrome on :9222 (C:\chrome-cdp\launch-cdp-chrome.bat,
# logged in to BrickLink).

$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path

# Self-update — ONLY inside the dedicated worktree. Guarded so a manual run from
# the main repo checkout can never hard-reset a working tree someone is using.
if ((Split-Path $repoRoot -Leaf) -eq "hb-assess-wt") {
    git -C $repoRoot fetch origin main --quiet
    git -C $repoRoot reset --hard origin/main --quiet
    Write-Host "hb-assess-wt updated to $(git -C $repoRoot rev-parse --short HEAD)"
}

$webDir = Join-Path $repoRoot "apps\web"
Set-Location $webDir

$logDir = Join-Path $repoRoot "tmp"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$log = Join-Path $logDir "store-assessment-batch-last-run.log"
"=== sweep started $(Get-Date -Format o) ===" | Out-File -FilePath $log -Encoding utf8

# npx writes a benign "npm warn config ignoring workspace config" line to stderr on
# every call; under ErrorActionPreference=Stop that stderr write is promoted to a
# terminating error and kills the runner BEFORE tsx starts (log ends after the header,
# exit 1, nothing swept). Same failure mode already documented and fixed in
# pg-refresh-cycle.ps1 — drop to Continue around the native call; $LASTEXITCODE is the
# real pass/fail signal.
$ErrorActionPreference = "Continue"
npx tsx scripts/store-assessment-batch.ts --budget=25 --min-age-days=5 2>&1 |
    Tee-Object -FilePath $log -Append

"=== sweep finished $(Get-Date -Format o) (exit $LASTEXITCODE) ===" | Out-File -FilePath $log -Append -Encoding utf8
exit $LASTEXITCODE
