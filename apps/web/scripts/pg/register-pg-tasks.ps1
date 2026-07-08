# register-pg-tasks.ps1 — one-time: register the four PG Market Intelligence Windows
# Scheduled Tasks (nightly lane D refresh, daily canary, monthly rank recompute, weekly
# digest).
#
# Prefer running from an ELEVATED PowerShell for S4U (run-while-logged-out); unelevated
# falls back to interactive-only per task, matching register-ebay-pricing-task.ps1 /
# register-ebay-bin-partout-task.ps1.
#
#   powershell -ExecutionPolicy Bypass -File apps\web\scripts\pg\register-pg-tasks.ps1
#
# ZERO Vercel footprint (done-criteria F3 hard constraint): all four jobs are either
# CDP/Chrome-bound (pg-refresh-cycle, pg-canary) or local-only Supabase compute
# (pg-rank, pg-digest) and must never be wired up as a Vercel cron/route.
$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Parent $PSCommandPath   # apps/web/scripts/pg

function Register-PgTask {
    param(
        [Parameter(Mandatory = $true)][string]$TaskName,
        [Parameter(Mandatory = $true)][string]$ScriptFile,
        [Parameter(Mandatory = $true)]$Trigger,
        [Parameter(Mandatory = $true)][string]$Description,
        [Parameter(Mandatory = $true)][TimeSpan]$ExecutionTimeLimit
    )

    $runnerPath = Join-Path $scriptDir $ScriptFile
    if (-not (Test-Path $runnerPath)) { throw "Runner not found: $runnerPath" }

    $existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    if ($existing) {
        Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
        Write-Host "Removed existing task: $TaskName" -ForegroundColor Yellow
    }

    $action = New-ScheduledTaskAction -Execute 'powershell.exe' `
        -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$runnerPath`"" `
        -WorkingDirectory $scriptDir

    $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopIfGoingOnBatteries `
        -AllowStartIfOnBatteries -DontStopOnIdleEnd -MultipleInstances IgnoreNew `
        -ExecutionTimeLimit $ExecutionTimeLimit

    # Prefer S4U (runs whether the user is logged on or not; no stored password). S4U
    # registration requires an ELEVATED shell; unelevated it throws "Access is denied",
    # so fall back to interactive-only rather than leaving NO task behind.
    $mode = 'S4U (runs while logged out)'
    try {
        $principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType S4U -RunLevel Limited
        Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $Trigger `
            -Settings $settings -Principal $principal -Description $Description -ErrorAction Stop | Out-Null
    } catch {
        Write-Host "S4U registration failed for $TaskName ($($_.Exception.Message.Trim())) - falling back to interactive-only." -ForegroundColor Yellow
        Write-Host "Re-run this script from an ELEVATED PowerShell to get run-while-logged-out." -ForegroundColor Yellow
        $mode = 'Interactive-only (task pauses while logged out; re-run elevated for S4U)'
        Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $Trigger `
            -Settings $settings -Description $Description -ErrorAction Stop | Out-Null
    }

    if (-not (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue)) {
        Write-Host "FAILED: task '$TaskName' does not exist after registration." -ForegroundColor Red
        exit 1
    }
    Write-Host "Task '$TaskName' registered. Logon mode: $mode" -ForegroundColor Green
}

$refreshTrigger = New-ScheduledTaskTrigger -Daily -At '00:05'
Register-PgTask -TaskName 'HadleyBricks-PG-Refresh-Cycle' -ScriptFile 'pg-refresh-cycle.ps1' `
    -Trigger $refreshTrigger -ExecutionTimeLimit (New-TimeSpan -Hours 7 -Minutes 30) `
    -Description 'Nightly BrickLink PG active-cycle refresh (lane D, catalogPG via domham91 CDP). Local-only - never Vercel.'

$canaryTrigger = New-ScheduledTaskTrigger -Daily -At '07:30'
Register-PgTask -TaskName 'HadleyBricks-PG-Canary' -ScriptFile 'pg-canary.ps1' `
    -Trigger $canaryTrigger -ExecutionTimeLimit (New-TimeSpan -Minutes 45) `
    -Description 'Daily golden-tuple canary: cross-lane price divergence check (anon-curl vs catalogPG). Local-only.'

# 09:00: safely clear of the nightly refresh window (00:05 + 7h30m limit = 07:35) so
# pg-rank never paginates tables lane D is actively writing (review finding #2).
$rankTrigger = New-ScheduledTaskTrigger -Daily -At '09:00'
Register-PgTask -TaskName 'HadleyBricks-PG-Rank' -ScriptFile 'pg-rank.ps1' `
    -Trigger $rankTrigger -ExecutionTimeLimit (New-TimeSpan -Minutes 30) `
    -Description 'Monthly ranking-cut recompute (runs daily, self-exits unless day 1). Local-only, no CDP needed.'

$digestTrigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday -At '07:45'
Register-PgTask -TaskName 'HadleyBricks-PG-Digest' -ScriptFile 'pg-digest.ps1' `
    -Trigger $digestTrigger -ExecutionTimeLimit (New-TimeSpan -Minutes 30) `
    -Description 'Weekly PG market digest (screens + own-store audit + coverage health -> markdown + Discord). Local-only, no CDP needed.'

Write-Host ''
Write-Host 'All four PG tasks registered.' -ForegroundColor Cyan
Write-Host "Test:  Start-ScheduledTask -TaskName 'HadleyBricks-PG-Refresh-Cycle'"
Write-Host "       Start-ScheduledTask -TaskName 'HadleyBricks-PG-Canary'"
Write-Host "       Start-ScheduledTask -TaskName 'HadleyBricks-PG-Rank'"
Write-Host "       Start-ScheduledTask -TaskName 'HadleyBricks-PG-Digest'"
Write-Host 'Inspect: Get-ScheduledTask -TaskName "HadleyBricks-PG-*" | Get-ScheduledTaskInfo'
