# Amazon Pricing (Local) - Windows Task Scheduler Registration
#
# Run once (elevated preferred). Schedules run-amazon-pricing.ps1 every
# 3 hours so the Amazon/Keepa pricing sync runs on the local NSSM Next.js
# server (localhost:3000) instead of Vercel — matching the paused GCP
# `amazon-pricing-sync` job's `0 */3 * * *` cadence.
#
# Prerequisites:
#   - Local NSSM Next.js service serving http://localhost:3000
#   - CRON_SECRET present in apps/web/.env.local
#   - GCP `amazon-pricing-sync` Cloud Scheduler job PAUSED (see
#     docs/vercel-cpu-reduction-2026-06-26.md) so the job does not also run on Vercel.

$taskName = "HadleyBricks-Amazon-Pricing-Local"
$workingDir = "C:\Users\Chris Hadley\claude-projects\hadley-bricks-inventory-management\scripts"
$scriptPath = Join-Path $workingDir "run-amazon-pricing.ps1"

$existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($existing) {
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
    Write-Host "Removed existing task: $taskName" -ForegroundColor Yellow
}

$action = New-ScheduledTaskAction `
    -Execute "powershell.exe" `
    -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$scriptPath`"" `
    -WorkingDirectory $workingDir

# Every 3 hours, starting shortly after registration (offset from the hour so
# it does not collide with the other HadleyBricks tasks that fire on the hour).
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(5) `
    -RepetitionInterval (New-TimeSpan -Hours 3) `
    -RepetitionDuration (New-TimeSpan -Days 3650)

$settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -DontStopIfGoingOnBatteries `
    -AllowStartIfOnBatteries `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 20)

$description = "Amazon/Keepa pricing sync every 3h run LOCALLY (off Vercel). Single POST to /api/cron/amazon-pricing on localhost:3000. Replaces the paused GCP amazon-pricing-sync Cloud Scheduler job."

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
Write-Host "Schedule: every 3 hours from 00:05 local"
Write-Host ""
Write-Host "To test: schtasks /run /tn '$taskName'" -ForegroundColor Cyan
