# eBay Auction Sniper (Local) — Windows Task Scheduler Registration
#
# Run once (elevated if registration is denied). Schedules run-ebay-auctions.ps1
# every 5 minutes so the auction sniper runs on the local NSSM Next.js server
# (localhost:3000) instead of Vercel, with a 5-minute scan window for contiguous
# coverage of auctions ending soon.
#
# Prerequisites:
#   - Local NSSM Next.js service serving http://localhost:3000
#   - CRON_SECRET present in apps/web/.env.local
#   - ebay_auction_config.scan_window_minutes = 5
#   - GCP `ebay-auction-sniper` Cloud Scheduler job PAUSED (see
#     docs/vercel-cpu-reduction-2026-06-26.md) so the scan does not also run on Vercel.

$taskName = "HadleyBricks-Ebay-Auctions-Local"
$workingDir = "C:\Users\Chris Hadley\claude-projects\hadley-bricks-inventory-management\scripts"
$scriptPath = Join-Path $workingDir "run-ebay-auctions.ps1"

$existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($existing) {
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
    Write-Host "Removed existing task: $taskName" -ForegroundColor Yellow
}

$action = New-ScheduledTaskAction `
    -Execute "powershell.exe" `
    -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$scriptPath`"" `
    -WorkingDirectory $workingDir

# Repeat every 5 minutes indefinitely (10-year duration — Task Scheduler
# rejects [TimeSpan]::MaxValue as an out-of-range XML duration).
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) `
    -RepetitionInterval (New-TimeSpan -Minutes 5) `
    -RepetitionDuration (New-TimeSpan -Days 3650)

$settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -DontStopIfGoingOnBatteries `
    -AllowStartIfOnBatteries `
    -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 4)

Register-ScheduledTask `
    -TaskName $taskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Description "eBay auction sniper run LOCALLY every 5 min (off Vercel). POSTs /api/cron/ebay-auctions on localhost:3000 (NEW + opt-in USED POV scans). Replaces the paused GCP ebay-auction-sniper Cloud Scheduler job."

Write-Host ""
Write-Host "Task '$taskName' registered successfully." -ForegroundColor Green
Write-Host "Schedule: every 5 minutes (starts ~1 min from now)"
Write-Host "Run log:  logs\ebay-auctions-local.log"
Write-Host ""
Write-Host "To test now: schtasks /run /tn `"$taskName`"" -ForegroundColor Cyan
