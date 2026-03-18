# Royal Mail Backfill — Windows Task Scheduler Registration
# Run this script once as Administrator to register the scheduled task.
#
# Schedule: Daily at 06:00 AM (1 hour before Cloud Run delivery report at 07:00)
# The delivery report pipeline trusts the cache — this job populates it.

$taskName = "HadleyBricks-RM-Backfill"
$workingDir = "C:\Users\Chris Hadley\claude-projects\hadley-bricks-inventory-management\apps\delivery-report"
$pythonExe = "C:\Users\Chris Hadley\AppData\Local\Programs\Python\Python313\python.exe"
$logFile = "$workingDir\rm_backfill.log"

# Remove existing task if present
$existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($existing) {
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
    Write-Host "Removed existing task: $taskName" -ForegroundColor Yellow
}

$action = New-ScheduledTaskAction `
    -Execute $pythonExe `
    -Argument "rm_backfill.py" `
    -WorkingDirectory $workingDir

$trigger = New-ScheduledTaskTrigger -Daily -At "06:00"

$settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -DontStopIfGoingOnBatteries `
    -AllowStartIfOnBatteries `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 10)

Register-ScheduledTask `
    -TaskName $taskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Description "Royal Mail tracking backfill via Chrome CDP. Runs daily at 06:00 before Cloud Run delivery report at 07:00."

Write-Host ""
Write-Host "Task '$taskName' registered successfully." -ForegroundColor Green
Write-Host "Schedule: Daily at 06:00 AM"
Write-Host "Working directory: $workingDir"
Write-Host "Python: $pythonExe"
Write-Host ""
Write-Host "To test manually: schtasks /run /tn '$taskName'" -ForegroundColor Cyan
Write-Host "To check status:  schtasks /query /tn '$taskName' /v /fo LIST" -ForegroundColor Cyan
