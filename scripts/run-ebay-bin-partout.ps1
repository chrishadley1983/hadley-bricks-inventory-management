# Local eBay BIN Part-Out Watcher Runner
#
# Drives one BIN part-out scan against the LOCAL Next.js server
# (http://localhost:3000) - zero Vercel cost. The /api/cron/ebay-bin-partout
# route watches newly-listed USED fixed-price LEGO listings for hit-list sets
# whose BrickLink used part-out value is a high multiple of the asking price.
# Quiet hours are enforced inside the route; the hit list self-refreshes from
# the POV cache when older than 24h.
#
# Scheduled every 15 minutes via register-ebay-bin-partout-task.ps1.
# Each run appends a one-line summary to logs\ebay-bin-partout-local.log.

$ErrorActionPreference = "Stop"

$envFile = Join-Path $PSScriptRoot "..\apps\web\.env.local"
$logFile = Join-Path $PSScriptRoot "..\logs\ebay-bin-partout-local.log"

function Write-RunLog([string]$line) {
    $stamped = "{0} {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $line
    Write-Host $stamped
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
        try { Add-Content -Path "$logFile.dropped" -Value $stamped -ErrorAction Stop } catch {}
    }
    try {
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

$uri = "http://localhost:3000/api/cron/ebay-bin-partout"
$headers = @{ "Authorization" = "Bearer $cronSecret" }

try {
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

$summary = "ok seen={0} new={1} matches={2} candidates={3} alerts={4} apiCalls={5} hitlist={6}{7} ms={8}" -f `
    $r.itemsSeen, $r.newItems, $r.hitlistMatches, $r.candidates, $r.alertsSent, `
    $r.apiCallsMade, $r.hitlistSize, $(if ($r.hitlistRefreshed) { "(refreshed)" } else { "" }), $r.durationMs
if ($r.error) { $summary = "ERROR-IN-SCAN $($r.error) | $summary" }
Write-RunLog $summary

if ($r.error) { exit 1 }
exit 0
