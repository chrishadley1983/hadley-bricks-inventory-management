# register-pov-refresh-task.ps1 — one-time: register the daily POV freshness top-up as a
# Windows Scheduled Task. Run once (no admin needed for a user-level task):
#   powershell -ExecutionPolicy Bypass -File apps\web\scripts\register-pov-refresh-task.ps1
#
# Schedule: 03:00 local daily. The POV scrape is CDP-bound (local Chrome) so it CANNOT run on
# Vercel; the matching Discord freshness report IS a Vercel cron (GCP scheduler) at 08:00 UTC, after
# this has finished. Typical runs ~3-4h; under heavy throttling (full 500 budget + many breathers) a
# run can approach the 6h ExecutionTimeLimit and be truncated — that simply surfaces as residual
# backlog the report flags next cycle (the budget cap still bounds each day's work).
$ErrorActionPreference = 'Stop'

$taskName = 'HadleyBricks-POV-Refresh'
$runner = Join-Path (Split-Path -Parent $PSCommandPath) 'pov-refresh.ps1'
if (-not (Test-Path $runner)) { throw "Runner not found: $runner" }

$action = New-ScheduledTaskAction -Execute 'powershell.exe' `
  -Argument "-ExecutionPolicy Bypass -NoProfile -File `"$runner`""
$trigger = New-ScheduledTaskTrigger -Daily -At 3:00AM
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopOnIdleEnd `
  -ExecutionTimeLimit (New-TimeSpan -Hours 6) -MultipleInstances IgnoreNew

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings `
  -Description 'Daily BrickLink Part-Out-Value freshness top-up (most-overdue stale rows, budget-capped).' `
  -Force | Out-Null

Write-Output "Registered scheduled task '$taskName' (daily 03:00)."
Write-Output "Run now to test:  Start-ScheduledTask -TaskName '$taskName'"
Write-Output "Inspect:          Get-ScheduledTask -TaskName '$taskName' | Get-ScheduledTaskInfo"
