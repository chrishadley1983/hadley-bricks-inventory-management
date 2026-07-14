# Local eBay Auction Sniper Runner
#
# Drives one eBay auction scan against the LOCAL Next.js server
# (http://localhost:3000) instead of Vercel, so the every-5-minutes sniper
# cadence costs zero Vercel Fluid Active CPU.
#
# The /api/cron/ebay-auctions route performs a single scan per call:
# NEW-condition search (Amazon-margin OR New-POV hybrid signal) plus, when
# ebay_auction_config.used_pov_mode_enabled is true, a USED-condition search
# judged on Used part-out value. Quiet hours are enforced inside the route.
#
# Scheduled every 5 minutes via register-ebay-auctions-task.ps1 (Windows Task
# Scheduler), matching scan_window_minutes=5 for contiguous coverage of
# auctions ending soon. The GCP `ebay-auction-sniper` Cloud Scheduler job is
# PAUSED in favour of this (see docs/vercel-cpu-reduction-2026-06-26.md).
# Requires the local NSSM Next.js service (localhost:3000) to be running.
#
# Each run appends a one-line summary to logs\ebay-auctions-local.log.

$ErrorActionPreference = "Stop"

$envFile = Join-Path $PSScriptRoot "..\apps\web\.env.local"
$logFile = Join-Path $PSScriptRoot "..\logs\ebay-auctions-local.log"

function Write-RunLog([string]$line) {
    $stamped = "{0} {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $line
    Write-Host $stamped
    # Retry the append: a reader holding the file (tail, editor) makes
    # Add-Content throw, and a swallowed failure silently drops run lines
    # (observed 2026-07-02: three runs completed but never logged).
    $written = $false
    foreach ($attempt in 1..4) {
        try {
            $logDir = Split-Path $logFile -Parent
            if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir | Out-Null }
            Add-Content -Path $logFile -Value $stamped -ErrorAction Stop
            $written = $true
            break
        } catch {
            Start-Sleep -Milliseconds 250
        }
    }
    if (-not $written) {
        # Last resort: sidecar file (different name -> no contention from log readers)
        try { Add-Content -Path "$logFile.dropped" -Value $stamped -ErrorAction Stop } catch {}
    }
    try {
        # Trim: keep the file bounded (~288 runs/day at 5-min cadence)
        if ((Test-Path $logFile) -and (Get-Item $logFile).Length -gt 2MB) {
            Get-Content $logFile -Tail 2000 | Set-Content "$logFile.tmp"
            Move-Item "$logFile.tmp" $logFile -Force
        }
    } catch {}
}

$cronMatch = Select-String -Path $envFile -Pattern "^CRON_SECRET=(.+)$"
$cronSecret = if ($cronMatch) { $cronMatch.Matches[0].Groups[1].Value.Trim() } else { "" }

if (-not $cronSecret) {
    Write-RunLog "ERROR CRON_SECRET not found in $envFile"
    exit 1
}

$uri = "http://localhost:3000/api/cron/ebay-auctions"
$headers = @{ "Authorization" = "Bearer $cronSecret" }

try {
    # 180s: comfortably under the task's 4-min ExecutionTimeLimit so a hung
    # request still reaches the catch and logs an ERROR line before the
    # scheduler would kill the run.
    $r = Invoke-RestMethod -Uri $uri -Method Post -Headers $headers -TimeoutSec 180
} catch {
    $detail = $_.Exception.Message
    if ($_.Exception.Response) {
        try {
            $reader = [System.IO.StreamReader]::new($_.Exception.Response.GetResponseStream())
            $detail += " | " + $reader.ReadToEnd()
        } catch {}
    }
    Write-RunLog "ERROR $detail"
    exit 1
}

if ($r.skipped) {
    Write-RunLog ("skipped reason={0}" -f $r.skipped)
    exit 0
}

$summary = "ok found={0} withSets={1} opps={2} alerts={3} joblots={4} apiCalls={5} keepa={6} ms={7}" -f `
    $r.auctionsFound, $r.auctionsWithSets, $r.opportunitiesFound, $r.alertsSent, `
    $r.joblotsFound, $r.apiCallsMade, $r.keepaCallsMade, $r.durationMs
if ($r.discordFailures -gt 0) { $summary = "ERROR-DISCORD failures=$($r.discordFailures) | $summary" }
if ($r.error) { $summary = "ERROR-IN-SCAN $($r.error) | $summary" }
Write-RunLog $summary

if ($r.error -or $r.discordFailures -gt 0) { exit 1 }
exit 0
