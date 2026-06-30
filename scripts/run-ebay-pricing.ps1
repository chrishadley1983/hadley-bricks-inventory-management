# Local eBay Pricing Sync Runner
#
# Drives the daily eBay arbitrage pricing sync against the LOCAL Next.js
# server (http://localhost:3000) instead of Vercel, so this once-daily batch
# no longer burns Vercel Fluid Active CPU.
#
# The /api/cron/ebay-pricing route is cursor-resumable: it prices up to 1,000
# watchlist items/day in 100-item batches and returns { complete: true } when
# done. This script mirrors the GCP pricing-sync-driver loop: POST repeatedly
# until complete, then exit.
#
# Scheduled daily via register-ebay-pricing-task.ps1 (Windows Task Scheduler).
# The GCP `ebay-pricing-sync` Cloud Scheduler job is PAUSED in favour of this
# (see docs/vercel-cpu-reduction-2026-06-26.md). Requires the local NSSM
# Next.js service (localhost:3000) to be running.

$ErrorActionPreference = "Stop"

$envFile = Join-Path $PSScriptRoot "..\apps\web\.env.local"
$cronMatch = Select-String -Path $envFile -Pattern "^CRON_SECRET=(.+)$"
$cronSecret = if ($cronMatch) { $cronMatch.Matches[0].Groups[1].Value.Trim() } else { "" }

if (-not $cronSecret) {
    Write-Host "CRON_SECRET not found in $envFile" -ForegroundColor Red
    exit 1
}

$uri = "http://localhost:3000/api/cron/ebay-pricing"
$headers = @{ "Authorization" = "Bearer $cronSecret" }
$maxIterations = 20   # 1,000-item daily limit / 100 per batch = 10, plus headroom
$delaySeconds = 2     # gentle gap between batches (local: no Vercel 5-min cap)
$maxConsecutiveErrors = 3

Write-Host "[ebay-pricing] Starting local pricing sync via $uri" -ForegroundColor Cyan

$iteration = 0
$consecutiveErrors = 0

while ($iteration -lt $maxIterations) {
    $iteration++

    try {
        $r = Invoke-RestMethod -Uri $uri -Method Post -Headers $headers -TimeoutSec 300
        $consecutiveErrors = 0
    } catch {
        $consecutiveErrors++
        Write-Host "[ebay-pricing] Iteration $iteration HTTP error: $($_.Exception.Message)" -ForegroundColor Red
        if ($_.Exception.Response) {
            try {
                $reader = [System.IO.StreamReader]::new($_.Exception.Response.GetResponseStream())
                Write-Host $reader.ReadToEnd() -ForegroundColor Red
            } catch {}
        }
        if ($consecutiveErrors -ge $maxConsecutiveErrors) {
            Write-Host "[ebay-pricing] $maxConsecutiveErrors consecutive errors - aborting" -ForegroundColor Red
            exit 1
        }
        Start-Sleep -Seconds $delaySeconds
        continue
    }

    $done = [bool]$r.complete
    Write-Host ("[ebay-pricing] Iteration {0}: processed={1} cursor={2} complete={3}" -f `
        $iteration, $r.processed, $r.cursorPosition, $done)

    if ($done) {
        Write-Host "[ebay-pricing] Complete after $iteration iteration(s). cursor=$($r.cursorPosition)" -ForegroundColor Green
        exit 0
    }

    Start-Sleep -Seconds $delaySeconds
}

Write-Host "[ebay-pricing] Reached max iterations ($maxIterations) without complete=true" -ForegroundColor Red
exit 1
