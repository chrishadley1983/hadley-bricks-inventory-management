# Bricqer Inventory Snapshot Refresh - Windows Task Scheduler Registration
#
# Run once (elevated preferred). Schedules run-bricqer-snapshot.ps1 FORTNIGHTLY —
# every second Sunday at 01:30 local time, ahead of the 02:15 store-assessment sweep,
# the 03:00 ebay-pricing task and the 05:30 keepa-refresh task.
#
# Why fortnightly and not nightly: a full sweep is ~312 Bricqer API calls (one per 100
# inventory items) and the consumers are decision aids, not order paths — the part-out
# OVERLAP panel, the store-quality scorecard and the demand-gap tool. Fortnightly keeps
# the snapshot inside its usefulness window without polling Bricqer for no reason.
# The panel surfaces `snapshotAt`, so drift stays visible between runs.
#
# Prerequisites:
#   - Dedicated worktree C:\Users\Chris Hadley\claude-projects\hb-assess-wt pinned to
#     origin/main (git worktree add --detach), node_modules junctioned from the main
#     checkout, apps/web/.env.local copied in. The task runs from THIS worktree because
#     the main checkout's branch changes constantly (Claude sessions) — repo files may
#     be absent when the task fires. The wrapper self-updates the worktree each run.
#   - Bricqer credentials in platform_credentials for the snapshot owner.
#   - Optional BRICQER_SNAPSHOT_USER_ID in that .env.local; otherwise the script's
#     default owner is used.
#
# No CDP Chrome needed — this task is API-only.

$taskName = "HadleyBricks-Bricqer-Snapshot-Local"
$workingDir = "C:\Users\Chris Hadley\claude-projects\hb-assess-wt\scripts"
$scriptPath = Join-Path $workingDir "run-bricqer-snapshot.ps1"

$existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($existing) {
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
    Write-Host "Removed existing task: $taskName" -ForegroundColor Yellow
}

$action = New-ScheduledTaskAction `
    -Execute "powershell.exe" `
    -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$scriptPath`"" `
    -WorkingDirectory $workingDir

# -WeeksInterval 2 is the actual fortnightly trigger; Task Scheduler counts from the
# first run, so the cadence holds even if a run is missed (StartWhenAvailable catches up).
$trigger = New-ScheduledTaskTrigger -Weekly -WeeksInterval 2 -DaysOfWeek Sunday -At "01:30"

$settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -DontStopIfGoingOnBatteries `
    -AllowStartIfOnBatteries `
    -ExecutionTimeLimit (New-TimeSpan -Hours 2)

$description = "Fortnightly Bricqer inventory snapshot refresh (~312 API calls): repopulates bricqer_inventory_snapshot so the part-out overlap panel, store-quality scorecard and demand-gap tool run on current stock."

# Prefer S4U (runs whether the user is logged on or not; no stored password).
# S4U registration requires an ELEVATED shell; unelevated it throws "Access is
# denied", so fall back to interactive-only rather than leaving NO task behind.
try {
    $principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType S4U -RunLevel Limited
    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger `
        -Settings $settings -Principal $principal -Description $description -ErrorAction Stop | Out-Null
    Write-Host "Registered $taskName (S4U) - fortnightly Sunday 01:30" -ForegroundColor Green
} catch {
    Write-Host "S4U registration failed ($($_.Exception.Message)); falling back to interactive-only" -ForegroundColor Yellow
    $principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger `
        -Settings $settings -Principal $principal -Description $description | Out-Null
    Write-Host "Registered $taskName (interactive) - fortnightly Sunday 01:30" -ForegroundColor Green
}
