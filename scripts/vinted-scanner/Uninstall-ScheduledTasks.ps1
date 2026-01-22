<#
.SYNOPSIS
    Removes the Vinted scanner scheduled tasks.

.DESCRIPTION
    This script removes both scheduled tasks created by Install-ScheduledTasks.ps1:
    - Vinted-BroadSweep
    - Vinted-WatchlistRotation

    Also cleans up the rotation state file.

.PARAMETER KeepState
    If specified, preserves the rotation state file for future reinstallation.

.EXAMPLE
    .\Uninstall-ScheduledTasks.ps1

.EXAMPLE
    .\Uninstall-ScheduledTasks.ps1 -KeepState

.NOTES
    Requires: Administrator privileges for Task Scheduler access
#>

[CmdletBinding()]
param(
    [Parameter()]
    [switch]$KeepState
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host "Removing Vinted scanner scheduled tasks..."

# Remove broad sweep task
try {
    Unregister-ScheduledTask `
        -TaskName "Vinted-BroadSweep" `
        -TaskPath "\Hadley Bricks\" `
        -Confirm:$false `
        -ErrorAction Stop

    Write-Host "  Removed: Vinted-BroadSweep"
} catch {
    Write-Host "  Vinted-BroadSweep not found (already removed)"
}

# Remove watchlist rotation task
try {
    Unregister-ScheduledTask `
        -TaskName "Vinted-WatchlistRotation" `
        -TaskPath "\Hadley Bricks\" `
        -Confirm:$false `
        -ErrorAction Stop

    Write-Host "  Removed: Vinted-WatchlistRotation"
} catch {
    Write-Host "  Vinted-WatchlistRotation not found (already removed)"
}

# Try to remove the task folder if empty
try {
    $RemainingTasks = Get-ScheduledTask -TaskPath "\Hadley Bricks\" -ErrorAction SilentlyContinue
    if (-not $RemainingTasks) {
        # Folder is empty, but can't easily remove via PowerShell
        Write-Host "  Task folder '\Hadley Bricks\' is empty"
    }
} catch {
    # Folder doesn't exist
}

# Clean up state file
$StateFile = Join-Path $ScriptDir ".watchlist-rotation-state.json"
if (-not $KeepState -and (Test-Path $StateFile)) {
    Remove-Item $StateFile -Force
    Write-Host "  Removed rotation state file"
} elseif ($KeepState -and (Test-Path $StateFile)) {
    Write-Host "  Preserved rotation state file (use -KeepState:$false to remove)"
}

Write-Host "`nUninstallation complete."
