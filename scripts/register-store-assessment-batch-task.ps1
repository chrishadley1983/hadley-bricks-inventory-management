# Store Assessment Nightly Sweep - Windows Task Scheduler Registration
#
# Run once (elevated preferred). Schedules run-store-assessment-batch.ps1 nightly
# at 02:15 local time — after the CDP Chrome's overnight idle window starts and
# clear of the 03:00 ebay-pricing and 05:30 keepa-refresh tasks.
#
# Prerequisites:
#   - Dedicated CDP Chrome on :9222, logged in to BrickLink
#   - STORE_ASSESSMENT_USER_ID in apps/web/.env.local (or a sole Bricqer snapshot owner)
#   - DISCORD_WEBHOOK_OPPORTUNITIES / _SYNC_STATUS / _ALERTS in apps/web/.env.local

$taskName = "HadleyBricks-Store-Assessment-Local"
$workingDir = "C:\Users\Chris Hadley\claude-projects\hadley-bricks-inventory-management\scripts"
$scriptPath = Join-Path $workingDir "run-store-assessment-batch.ps1"

$existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($existing) {
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
    Write-Host "Removed existing task: $taskName" -ForegroundColor Yellow
}

$action = New-ScheduledTaskAction `
    -Execute "powershell.exe" `
    -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$scriptPath`"" `
    -WorkingDirectory $workingDir

$trigger = New-ScheduledTaskTrigger -Daily -At "02:15"

$settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -DontStopIfGoingOnBatteries `
    -AllowStartIfOnBatteries `
    -ExecutionTimeLimit (New-TimeSpan -Hours 3)

$description = "Nightly BL store-assessment sweep: stalest watchlist stores re-assessed from the price/STR caches (one polite CDP scrape per store); Discord alerts on BUY verdicts and material deltas."

# Prefer S4U (runs whether the user is logged on or not; no stored password).
# S4U registration requires an ELEVATED shell; unelevated it throws "Access is
# denied", so fall back to interactive-only rather than leaving NO task behind.
try {
    $principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType S4U -RunLevel Limited
    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger `
        -Settings $settings -Principal $principal -Description $description -ErrorAction Stop | Out-Null
    Write-Host "Registered $taskName (S4U) - nightly 02:15" -ForegroundColor Green
} catch {
    Write-Host "S4U registration failed ($($_.Exception.Message)); falling back to interactive-only" -ForegroundColor Yellow
    $principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger `
        -Settings $settings -Principal $principal -Description $description | Out-Null
    Write-Host "Registered $taskName (interactive) - nightly 02:15" -ForegroundColor Green
}
