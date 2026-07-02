# Keepa Refresh (Local) - Windows Task Scheduler Registration
#
# Run once as Administrator. Schedules run-keepa-refresh.ps1 daily at 05:30
# local time so Keepa snapshots keep flowing into price_snapshots (training
# labels + demand data) on the local NSSM Next.js server (localhost:3000)
# instead of Vercel.
#
# Prerequisites:
#   - Local NSSM Next.js service serving http://localhost:3000
#   - CRON_SECRET present in apps/web/.env.local
#   - KEEPA_API_KEY configured for the local server

$taskName = "HadleyBricks-Keepa-Refresh-Local"
$workingDir = "C:\Users\Chris Hadley\claude-projects\hadley-bricks-inventory-management\scripts"
$scriptPath = Join-Path $workingDir "run-keepa-refresh.ps1"

$existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($existing) {
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
    Write-Host "Removed existing task: $taskName" -ForegroundColor Yellow
}

$action = New-ScheduledTaskAction `
    -Execute "powershell.exe" `
    -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$scriptPath`"" `
    -WorkingDirectory $workingDir

$trigger = New-ScheduledTaskTrigger -Daily -At "05:30"

$settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -DontStopIfGoingOnBatteries `
    -AllowStartIfOnBatteries `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 45)

$description = "Daily Keepa snapshot refresh run LOCALLY (off Vercel). Calls /api/cron/keepa-refresh on localhost:3000 with a 25-min budget; staleness ordering rotates through all candidate sets."

# Prefer S4U (runs whether the user is logged on or not; no stored password).
# S4U registration requires an ELEVATED shell; unelevated it throws "Access is
# denied", so fall back to interactive-only rather than leaving NO task behind.
try {
    $principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType S4U -RunLevel Limited
    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger `
        -Settings $settings -Principal $principal -Description $description | Out-Null
    Write-Host "Registered $taskName (S4U) - runs daily at 05:30" -ForegroundColor Green
} catch {
    Write-Host "S4U registration failed ($($_.Exception.Message)); falling back to interactive logon" -ForegroundColor Yellow
    $principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger `
        -Settings $settings -Principal $principal -Description $description | Out-Null
    Write-Host "Registered $taskName (interactive) - runs daily at 05:30" -ForegroundColor Green
}
