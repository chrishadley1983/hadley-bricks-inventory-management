# eBay Pricing (Local) — Windows Task Scheduler Registration
#
# Run once as Administrator. Schedules run-ebay-pricing.ps1 daily at 03:00
# local time so the eBay arbitrage pricing sync runs on the local NSSM
# Next.js server (localhost:3000) instead of Vercel.
#
# Prerequisites:
#   - Local NSSM Next.js service serving http://localhost:3000
#   - CRON_SECRET present in apps/web/.env.local
#   - GCP `ebay-pricing-sync` Cloud Scheduler job PAUSED (see
#     docs/vercel-cpu-reduction-2026-06-26.md) so the job does not also run on Vercel.

$taskName = "HadleyBricks-Ebay-Pricing-Local"
$workingDir = "C:\Users\Chris Hadley\claude-projects\hadley-bricks-inventory-management\scripts"
$scriptPath = Join-Path $workingDir "run-ebay-pricing.ps1"

$existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($existing) {
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
    Write-Host "Removed existing task: $taskName" -ForegroundColor Yellow
}

$action = New-ScheduledTaskAction `
    -Execute "powershell.exe" `
    -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$scriptPath`"" `
    -WorkingDirectory $workingDir

$trigger = New-ScheduledTaskTrigger -Daily -At "03:00"

$settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -DontStopIfGoingOnBatteries `
    -AllowStartIfOnBatteries `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 30)

Register-ScheduledTask `
    -TaskName $taskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Description "Daily eBay arbitrage pricing sync run LOCALLY (off Vercel). Loops /api/cron/ebay-pricing on localhost:3000 until complete. Replaces the paused GCP ebay-pricing-sync Cloud Scheduler job."

Write-Host ""
Write-Host "Task '$taskName' registered successfully." -ForegroundColor Green
Write-Host "Schedule: Daily at 03:00"
Write-Host ""
Write-Host "To test: schtasks /run /tn '$taskName'" -ForegroundColor Cyan
