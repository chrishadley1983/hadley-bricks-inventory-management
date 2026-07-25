# Bricqer Inventory Snapshot Refresh Runner
#
# Re-syncs bricqer_inventory_snapshot from the Bricqer API. Downstream consumers:
# the store-quality scorecard, the demand-gap tool, and the Set Lookup part-out
# OVERLAP panel (NEW / RESTOCK / DUPLICATE against our own stock). Nothing else
# refreshes this table, so when it goes stale the overlap panel silently degrades —
# it keeps rendering, just against weeks-old stock.
#
# COST: one Bricqer API call per 100 inventory items. At ~31k items that is ~312
# calls per run, ~624/month on the fortnightly schedule. No BrickLink calls.
#
# DEPLOYMENT: the scheduled task points at the copy of this script inside the
# DEDICATED worktree C:\Users\Chris Hadley\claude-projects\hb-assess-wt, which is
# pinned to origin/main and self-updates below. The main repo checkout can't be
# used — Claude sessions constantly switch its branch, so repo files may be absent
# when the task fires. node_modules are junctioned from the main checkout;
# apps/web/.env.local is a manual copy — refresh it if secrets rotate.
#
# Scheduled fortnightly via register-bricqer-snapshot-task.ps1.

$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path

# Self-update — ONLY inside a dedicated worktree. Guarded so a manual run from the
# main repo checkout (or a feature worktree) can never hard-reset a tree in use.
if ((Split-Path $repoRoot -Leaf) -like "hb-*-wt") {
    git -C $repoRoot fetch origin main --quiet
    git -C $repoRoot reset --hard origin/main --quiet
    Write-Host "$(Split-Path $repoRoot -Leaf) updated to $(git -C $repoRoot rev-parse --short HEAD)"
}

$webDir = Join-Path $repoRoot "apps\web"
Set-Location $webDir

$logDir = Join-Path $repoRoot "tmp"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$log = Join-Path $logDir "bricqer-snapshot-last-run.log"
"=== snapshot refresh started $(Get-Date -Format o) ===" | Out-File -FilePath $log -Encoding utf8

# npx writes a benign "npm warn config ignoring workspace config" line to stderr on
# every call; under ErrorActionPreference=Stop that stderr write is promoted to a
# terminating error and kills the runner BEFORE tsx starts. Same failure mode as
# pg-refresh-cycle.ps1 / run-store-assessment-batch.ps1 — drop to Continue around the
# native call; $LASTEXITCODE is the real pass/fail signal.
$ErrorActionPreference = "Continue"

# Full sweep (not --resume): starts at page 1 so stale rows are pruned and
# last_full_sync is honest. See the header of refresh-bricqer-snapshot.ts.
npx tsx scripts/refresh-bricqer-snapshot.ts 2>&1 | Tee-Object -FilePath $log -Append

"=== snapshot refresh finished $(Get-Date -Format o) (exit $LASTEXITCODE) ===" |
    Out-File -FilePath $log -Append -Encoding utf8
exit $LASTEXITCODE
