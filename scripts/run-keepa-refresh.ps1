# Local Keepa Refresh Runner
#
# Drives the daily Keepa snapshot refresh against the LOCAL Next.js server
# (http://localhost:3000) so the token-throttled Keepa import (which can idle
# for minutes waiting on token refill) never fights Vercel's 300s cap and
# burns no Vercel Fluid CPU.
#
# The /api/cron/keepa-refresh route picks the stalest sets from
# keepa_refresh_candidates and imports them with the v2 (triple-parse) BUY_BOX
# parser. Staleness ordering makes the candidate pool rotate automatically, so
# a single bounded run per day is enough.
#
# Scheduled daily via register-keepa-refresh-task.ps1 (Windows Task Scheduler).
# Requires the local NSSM Next.js service (localhost:3000) to be running.

$ErrorActionPreference = "Stop"

$envFile = Join-Path $PSScriptRoot "..\apps\web\.env.local"
$cronMatch = Select-String -Path $envFile -Pattern "^CRON_SECRET=(.+)$"
$cronSecret = if ($cronMatch) { $cronMatch.Matches[0].Groups[1].Value.Trim() } else { "" }

if (-not $cronSecret) {
    Write-Host "CRON_SECRET not found in $envFile" -ForegroundColor Red
    exit 1
}

# 500 ASINs and a 25-minute internal time budget; the route stops at whichever
# limit it hits first and the next day's run picks up the stalest remainder.
$uri = "http://localhost:3000/api/cron/keepa-refresh?limit=500&time_budget_ms=1500000"
$headers = @{ "Authorization" = "Bearer $cronSecret" }

Write-Host "[keepa-refresh] Starting local Keepa refresh via $uri" -ForegroundColor Cyan

try {
    $r = Invoke-RestMethod -Uri $uri -Method Post -Headers $headers -TimeoutSec 1800
} catch {
    Write-Host "[keepa-refresh] HTTP error: $($_.Exception.Message)" -ForegroundColor Red
    if ($_.Exception.Response) {
        try {
            $reader = [System.IO.StreamReader]::new($_.Exception.Response.GetResponseStream())
            Write-Host $reader.ReadToEnd() -ForegroundColor Red
        } catch {}
    }
    exit 1
}

Write-Host ("[keepa-refresh] Done: processed={0}/{1} snapshots={2} failed={3} stopped_early={4} in {5}ms" -f `
    $r.asins_processed, $r.candidates, $r.snapshots_imported, $r.failed, $r.stopped_early_on_time_budget, $r.duration_ms) -ForegroundColor Green
exit 0
