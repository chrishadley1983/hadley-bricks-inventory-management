# Local Discord Alerting Health Check Runner
#
# Drives the daily /api/cron/discord-health dead-man check against the LOCAL
# Next.js server (http://localhost:3000). The route verifies that every
# required DISCORD_WEBHOOK_* env var is present in the RUNNING server process
# (catches stale env after a service restart), that each webhook still exists
# on Discord's side (catches deleted webhooks), and that no eBay alert rows
# are stuck undelivered (discord_sent=false).
#
# Born from the 2026-07-10..14 outage: a stale service env silently dropped
# every eBay opportunity alert for four days while all run logs said "sent".
#
# Scheduled daily via register-discord-health-task.ps1.
# Each run appends a one-line summary to logs\discord-health-local.log.

$ErrorActionPreference = "Stop"

$envFile = Join-Path $PSScriptRoot "..\apps\web\.env.local"
$logFile = Join-Path $PSScriptRoot "..\logs\discord-health-local.log"

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

$uri = "http://localhost:3000/api/cron/discord-health"
$headers = @{ "Authorization" = "Bearer $cronSecret" }

try {
    $r = Invoke-RestMethod -Uri $uri -Method Post -Headers $headers -TimeoutSec 120
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

if ($r.problems.Count -gt 0) {
    Write-RunLog ("UNHEALTHY problems={0} webhooks={1} stuck={2}: {3}" -f `
        $r.problems.Count, $r.webhooksChecked, $r.stuckAlerts, ($r.problems -join " | "))
    exit 1
}

Write-RunLog ("ok healthy webhooks={0} stuck={1} ms={2}" -f $r.webhooksChecked, $r.stuckAlerts, $r.durationMs)
exit 0
