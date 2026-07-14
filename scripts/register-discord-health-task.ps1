# Discord Alerting Health Check (Local) - Windows Task Scheduler Registration
#
# Run once (from an ELEVATED shell for S4U / run-while-logged-out; unelevated
# falls back to interactive-only). Schedules run-discord-health.ps1 daily at
# 08:00 against the local NSSM Next.js server (localhost:3000).
#
# Prerequisites:
#   - Local NSSM Next.js service serving http://localhost:3000 (with a build
#     that includes /api/cron/discord-health)
#   - CRON_SECRET present in apps/web/.env.local

$taskName = "HadleyBricks-Discord-Health-Local"
$workingDir = "C:\Users\Chris Hadley\claude-projects\hadley-bricks-inventory-management\scripts"
$scriptPath = Join-Path $workingDir "run-discord-health.ps1"

$existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($existing) {
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
    Write-Host "Removed existing task: $taskName" -ForegroundColor Yellow
}

$action = New-ScheduledTaskAction `
    -Execute "powershell.exe" `
    -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$scriptPath`"" `
    -WorkingDirectory $workingDir

$trigger = New-ScheduledTaskTrigger -Daily -At "08:00"

$settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -DontStopIfGoingOnBatteries `
    -AllowStartIfOnBatteries `
    -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 5)

$description = "Daily dead-man check of the Discord alerting pipeline. POSTs /api/cron/discord-health on localhost:3000 - verifies webhook env vars in the running server, webhook existence on Discord, and no stuck undelivered eBay alerts."

# Prefer S4U (runs whether the user is logged on or not; no stored password).
$mode = "S4U (runs while logged out)"
try {
    $principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType S4U -RunLevel Limited
    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger `
        -Settings $settings -Principal $principal -Description $description -ErrorAction Stop | Out-Null
} catch {
    Write-Host "S4U registration failed ($($_.Exception.Message.Trim())) - falling back to interactive-only." -ForegroundColor Yellow
    Write-Host "Re-run this script from an ELEVATED PowerShell to get run-while-logged-out." -ForegroundColor Yellow
    $mode = "Interactive-only (task pauses while logged out; re-run elevated for S4U)"
    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger `
        -Settings $settings -Description $description -ErrorAction Stop | Out-Null
}

if (-not (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue)) {
    Write-Host "FAILED: task '$taskName' does not exist after registration." -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "Task '$taskName' registered successfully. Logon mode: $mode" -ForegroundColor Green
Write-Host "Schedule: daily at 08:00"
Write-Host "Run log:  logs\discord-health-local.log"
Write-Host ""
Write-Host "To test now: schtasks /run /tn `"$taskName`"" -ForegroundColor Cyan
