# Vercel Usage Scraper — Windows Task Scheduler Registration
# Run once as Administrator. Scrapes Vercel dashboard at 06:30 daily
# so the 07:00 vercel-usage cron has fresh data.
#
# Prerequisite: Chrome CDP at port 9222 must be logged into Vercel.

$taskName = "HadleyBricks-Vercel-Usage-Scraper"
$workingDir = "C:\Users\Chris Hadley\claude-projects\hadley-bricks-inventory-management\scripts"
$pythonExe = "C:\Users\Chris Hadley\AppData\Local\Programs\Python\Python313\python.exe"

$existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($existing) {
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
    Write-Host "Removed existing task: $taskName" -ForegroundColor Yellow
}

$action = New-ScheduledTaskAction `
    -Execute $pythonExe `
    -Argument "vercel-usage-scraper.py" `
    -WorkingDirectory $workingDir

$trigger = New-ScheduledTaskTrigger -Daily -At "06:30"

$settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -DontStopIfGoingOnBatteries `
    -AllowStartIfOnBatteries `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 5)

Register-ScheduledTask `
    -TaskName $taskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Description "Scrape Vercel dashboard usage metrics via Chrome CDP. Runs daily at 06:30 before vercel-usage cron at 07:00."

Write-Host ""
Write-Host "Task '$taskName' registered successfully." -ForegroundColor Green
Write-Host "Schedule: Daily at 06:30 AM"
Write-Host ""
Write-Host "To test: schtasks /run /tn '$taskName'" -ForegroundColor Cyan
