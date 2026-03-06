# Setup Windows Task Scheduler job for Review Queue Processor
# Run this script once as Administrator to register the scheduled task.

$taskName = "Hadley Bricks - Review Queue"
$workingDir = "C:\Users\Chris Hadley\claude-projects\hadley-bricks-inventory-management\apps\review-queue-processor"
$pythonExe = "C:\Users\Chris Hadley\AppData\Local\Programs\Python\Python313\python.exe"

# Remove existing task if present
$existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($existing) {
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
    Write-Host "Removed existing task: $taskName"
}

$action = New-ScheduledTaskAction `
    -Execute $pythonExe `
    -Argument "run.py" `
    -WorkingDirectory $workingDir

$trigger = New-ScheduledTaskTrigger -Daily -At "09:20"

$settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -DontStopIfGoingOnBatteries `
    -AllowStartIfOnBatteries

Register-ScheduledTask `
    -TaskName $taskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Description "Process review queue with AI set identification (runs daily at 9:20 AM)"

Write-Host ""
Write-Host "Task '$taskName' registered successfully." -ForegroundColor Green
Write-Host "Schedule: Daily at 09:20 AM"
Write-Host "Working directory: $workingDir"
Write-Host ""
Write-Host "To test manually: schtasks /run /tn '$taskName'"
