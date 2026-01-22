<#
.SYNOPSIS
    Installs Windows Task Scheduler tasks for Vinted scanning.

.DESCRIPTION
    This script creates two scheduled tasks:
    1. BroadSweep - Runs hourly from 08:00-22:00
    2. WatchlistRotation - Runs every 5 minutes from 08:00-22:00

    Both tasks are disabled by default and must be manually enabled
    after configuration is complete.

.PARAMETER AuthToken
    The Supabase auth token for API authentication.

.PARAMETER ApiUrl
    The base URL of the application API. Defaults to http://localhost:3000.

.PARAMETER Enable
    If specified, enables the tasks immediately after creation.

.EXAMPLE
    .\Install-ScheduledTasks.ps1 -AuthToken "eyJhbGc..."

.EXAMPLE
    .\Install-ScheduledTasks.ps1 -AuthToken "eyJhbGc..." -Enable

.NOTES
    Requires: Administrator privileges for Task Scheduler access
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$AuthToken,

    [Parameter()]
    [string]$ApiUrl = "http://localhost:3000",

    [Parameter()]
    [switch]$Enable
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

# Verify scripts exist
$BroadSweepScript = Join-Path $ScriptDir "Invoke-BroadSweep.ps1"
$WatchlistScript = Join-Path $ScriptDir "Invoke-WatchlistRotation.ps1"

if (-not (Test-Path $BroadSweepScript)) {
    Write-Error "Broad sweep script not found: $BroadSweepScript"
    exit 1
}

if (-not (Test-Path $WatchlistScript)) {
    Write-Error "Watchlist script not found: $WatchlistScript"
    exit 1
}

# Create the broad sweep task
Write-Host "Creating broad sweep scheduled task..."

$BroadSweepAction = New-ScheduledTaskAction `
    -Execute "powershell.exe" `
    -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$BroadSweepScript`" -ApiUrl `"$ApiUrl`" -AuthToken `"$AuthToken`""

# Run every hour from 08:00 to 21:00 (last run at 21:00)
$BroadSweepTriggers = @()
for ($hour = 8; $hour -le 21; $hour++) {
    $BroadSweepTriggers += New-ScheduledTaskTrigger `
        -Daily `
        -At ([datetime]::Today.AddHours($hour))
}

$BroadSweepSettings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -MultipleInstances IgnoreNew

$BroadSweepTask = @{
    TaskName = "Vinted-BroadSweep"
    TaskPath = "\Hadley Bricks\"
    Action = $BroadSweepAction
    Trigger = $BroadSweepTriggers
    Settings = $BroadSweepSettings
    Description = "Hourly broad sweep scan of Vinted LEGO listings for arbitrage opportunities"
}

# Remove existing task if present
Unregister-ScheduledTask -TaskName "Vinted-BroadSweep" -TaskPath "\Hadley Bricks\" -Confirm:$false -ErrorAction SilentlyContinue

# Create the task
Register-ScheduledTask @BroadSweepTask

if (-not $Enable) {
    Disable-ScheduledTask -TaskName "Vinted-BroadSweep" -TaskPath "\Hadley Bricks\"
}

Write-Host "Broad sweep task created."

# Create the watchlist rotation task
Write-Host "Creating watchlist rotation scheduled task..."

$WatchlistAction = New-ScheduledTaskAction `
    -Execute "powershell.exe" `
    -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$WatchlistScript`" -ApiUrl `"$ApiUrl`" -AuthToken `"$AuthToken`""

# Run every 5 minutes from 08:00 to 22:00
$WatchlistTrigger = New-ScheduledTaskTrigger `
    -Once `
    -At ([datetime]::Today.AddHours(8)) `
    -RepetitionInterval (New-TimeSpan -Minutes 5) `
    -RepetitionDuration (New-TimeSpan -Hours 14)

$WatchlistSettings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 4)

$WatchlistTask = @{
    TaskName = "Vinted-WatchlistRotation"
    TaskPath = "\Hadley Bricks\"
    Action = $WatchlistAction
    Trigger = $WatchlistTrigger
    Settings = $WatchlistSettings
    Description = "Rotates through watchlist sets every 5 minutes, scanning for arbitrage opportunities"
}

# Remove existing task if present
Unregister-ScheduledTask -TaskName "Vinted-WatchlistRotation" -TaskPath "\Hadley Bricks\" -Confirm:$false -ErrorAction SilentlyContinue

# Create the task
Register-ScheduledTask @WatchlistTask

if (-not $Enable) {
    Disable-ScheduledTask -TaskName "Vinted-WatchlistRotation" -TaskPath "\Hadley Bricks\"
}

Write-Host "Watchlist rotation task created."

# Summary
Write-Host "`n=== Installation Complete ===`n"
Write-Host "Created tasks in Task Scheduler folder: \Hadley Bricks\"
Write-Host ""
Write-Host "Tasks:"
Write-Host "  1. Vinted-BroadSweep - Hourly 08:00-21:00"
Write-Host "  2. Vinted-WatchlistRotation - Every 5 min 08:00-22:00"
Write-Host ""

if (-not $Enable) {
    Write-Host "Both tasks are DISABLED. Enable them when ready:"
    Write-Host ""
    Write-Host "  Enable-ScheduledTask -TaskName 'Vinted-BroadSweep' -TaskPath '\Hadley Bricks\'"
    Write-Host "  Enable-ScheduledTask -TaskName 'Vinted-WatchlistRotation' -TaskPath '\Hadley Bricks\'"
    Write-Host ""
    Write-Host "Or use the scanner dashboard in the web app to enable/disable."
} else {
    Write-Host "Tasks are ENABLED and will start running at the next scheduled time."
}

Write-Host "`nTo view tasks:"
Write-Host "  Get-ScheduledTask -TaskPath '\Hadley Bricks\'"
Write-Host ""
Write-Host "To run manually:"
Write-Host "  Start-ScheduledTask -TaskName 'Vinted-BroadSweep' -TaskPath '\Hadley Bricks\'"
