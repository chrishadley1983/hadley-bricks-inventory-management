# Local Amazon Pricing Sync Runner
#
# Drives one Amazon pricing sync (Keepa budget-spread batch) against the
# LOCAL Next.js server (http://localhost:3000) instead of Vercel, so the
# every-3-hours cadence burns no Vercel Fluid Active CPU. This was the #1
# remaining Vercel cron consumer (~210 wall-s/day steady, plus an 894s-per-run
# timeout storm on 2-3 Jul 2026 that tipped the Fluid CPU alert).
#
# The /api/cron/amazon-pricing route is self-contained: each call picks the
# highest-priority ~57 ASINs (in-stock first), syncs them via Keepa, and
# returns { complete: true }. One POST per run — no driver loop needed
# (the GCP pricing-sync-driver used maxIterations=1 for this job).
#
# Scheduled every 3 hours via register-amazon-pricing-task.ps1 (Windows Task
# Scheduler). The GCP `amazon-pricing-sync` Cloud Scheduler job is PAUSED in
# favour of this (see docs/vercel-cpu-reduction-2026-06-26.md). Requires the
# local NSSM Next.js service (localhost:3000) to be running.
#
# Each run appends a one-line summary to logs\amazon-pricing-local.log.

$ErrorActionPreference = "Stop"

$envFile = Join-Path $PSScriptRoot "..\apps\web\.env.local"
$logFile = Join-Path $PSScriptRoot "..\logs\amazon-pricing-local.log"

function Write-RunLog([string]$line) {
    $stamped = "{0} {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $line
    Write-Host $stamped
    # Retry the append: a reader holding the file makes Add-Content throw,
    # and a swallowed failure silently drops run lines.
    foreach ($attempt in 1..4) {
        try {
            $logDir = Split-Path $logFile -Parent
            if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir | Out-Null }
            Add-Content -Path $logFile -Value $stamped -ErrorAction Stop
            return
        } catch {
            Start-Sleep -Milliseconds 250
        }
    }
}

$cronMatch = Select-String -Path $envFile -Pattern "^CRON_SECRET=(.+)$"
$cronSecret = if ($cronMatch) { $cronMatch.Matches[0].Groups[1].Value.Trim() } else { "" }

if (-not $cronSecret) {
    Write-RunLog "[amazon-pricing] FAIL: CRON_SECRET not found in $envFile"
    exit 1
}

$uri = "http://localhost:3000/api/cron/amazon-pricing"
$headers = @{ "Authorization" = "Bearer $cronSecret" }

try {
    # Route's internal budget is 300s; normal runs complete in ~25-35s.
    $r = Invoke-RestMethod -Uri $uri -Method Post -Headers $headers -TimeoutSec 360
} catch {
    Write-RunLog "[amazon-pricing] FAIL: HTTP error: $($_.Exception.Message)"
    exit 1
}

if ($r.error -or $r.success -eq $false) {
    Write-RunLog "[amazon-pricing] FAIL: route reported failure: $($r | ConvertTo-Json -Compress -Depth 4)"
    exit 1
}

$summary = "processed=$($r.processed) inStockSynced=$($r.inStockSynced) staleSynced=$($r.staleSynced) rateLimited=$($r.rateLimited)"
Write-RunLog "[amazon-pricing] OK: $summary"
