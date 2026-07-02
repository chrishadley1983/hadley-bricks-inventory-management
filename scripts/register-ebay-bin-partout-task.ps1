# eBay BIN Part-Out Watcher (Local) - Windows Task Scheduler Registration
#
# Run once (from an ELEVATED shell for S4U / run-while-logged-out; unelevated
# falls back to interactive-only). Schedules run-ebay-bin-partout.ps1 every
# 15 minutes against the local NSSM Next.js server (localhost:3000).
#
# Prerequisites:
#   - Local NSSM Next.js service serving http://localhost:3000
#   - CRON_SECRET present in apps/web/.env.local
#   - ebay_bin_config row enabled (defaults inserted by migration)

$taskName = "HadleyBricks-Ebay-Bin-Partout-Local"
$workingDir = "C:\Users\Chris Hadley\claude-projects\hadley-bricks-inventory-management\scripts"
$scriptPath = Join-Path $workingDir "run-ebay-bin-partout.ps1"

$existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($existing) {
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
    Write-Host "Removed existing task: $taskName" -ForegroundColor Yellow
}

$action = New-ScheduledTaskAction `
    -Execute "powershell.exe" `
    -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$scriptPath`"" `
    -WorkingDirectory $workingDir

# Repeat every 15 minutes indefinitely (10-year duration - Task Scheduler
# rejects [TimeSpan]::MaxValue as an out-of-range XML duration).
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) `
    -RepetitionInterval (New-TimeSpan -Minutes 15) `
    -RepetitionDuration (New-TimeSpan -Days 3650)

$settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -DontStopIfGoingOnBatteries `
    -AllowStartIfOnBatteries `
    -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 4)

$description = "eBay BIN part-out watcher run LOCALLY every 15 min. POSTs /api/cron/ebay-bin-partout on localhost:3000 - newly-listed USED fixed-price LEGO vs the BrickLink part-out hit list."

# Prefer S4U (runs whether the user is logged on or not; no stored password).
# S4U registration requires an ELEVATED shell; unelevated it throws "Access is
# denied", so fall back to interactive-only rather than leaving NO task behind.
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
Write-Host "Schedule: every 15 minutes (starts ~1 min from now)"
Write-Host "Run log:  logs\ebay-bin-partout-local.log"
Write-Host ""
Write-Host "To test now: schtasks /run /tn `"$taskName`"" -ForegroundColor Cyan
