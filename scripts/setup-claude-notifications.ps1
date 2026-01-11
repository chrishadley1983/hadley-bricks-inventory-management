# setup-claude-notifications.ps1
# Run this in any project to add Claude Code notification hooks
# Usage: .\scripts\setup-claude-notifications.ps1

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $scriptDir

# Ensure scripts folder exists
$scriptsPath = Join-Path $projectRoot "scripts"
if (-not (Test-Path $scriptsPath)) {
    New-Item -ItemType Directory -Path $scriptsPath -Force | Out-Null
}

# Create notify.ps1
$notifyScript = @'
# notify.ps1 - Portable notification script for Claude Code events
# Usage: .\notify.ps1 -Title "Task Complete" -Message "Your build finished"
# Usage: .\notify.ps1 -Message "Permission needed" -Sound warning

param(
    [string]$Title = "Claude Code",
    [string]$Message = "Attention needed",
    [ValidateSet("default", "warning", "success", "error")]
    [string]$Sound = "default"
)

# Play sound based on type
switch ($Sound) {
    "warning" { [System.Media.SystemSounds]::Exclamation.Play() }
    "success" { [System.Media.SystemSounds]::Asterisk.Play() }
    "error"   { [System.Media.SystemSounds]::Hand.Play() }
    default   { [System.Media.SystemSounds]::Beep.Play() }
}

# Show Windows toast notification (works even when window not focused)
Add-Type -AssemblyName System.Windows.Forms

# Create balloon notification
$balloon = New-Object System.Windows.Forms.NotifyIcon
$balloon.Icon = [System.Drawing.SystemIcons]::Information
$balloon.BalloonTipIcon = [System.Windows.Forms.ToolTipIcon]::Info
$balloon.BalloonTipTitle = $Title
$balloon.BalloonTipText = $Message
$balloon.Visible = $true
$balloon.ShowBalloonTip(5000)

# Keep script alive briefly so notification displays, then cleanup
Start-Sleep -Milliseconds 100
'@

$notifyPath = Join-Path $scriptsPath "notify.ps1"
Set-Content -Path $notifyPath -Value $notifyScript
Write-Host "Created: $notifyPath" -ForegroundColor Green

# Ensure .claude folder exists
$claudeDir = Join-Path $projectRoot ".claude"
if (-not (Test-Path $claudeDir)) {
    New-Item -ItemType Directory -Path $claudeDir -Force | Out-Null
}

# Read or create settings.local.json
$settingsPath = Join-Path $claudeDir "settings.local.json"
$settings = @{}

if (Test-Path $settingsPath) {
    $content = Get-Content $settingsPath -Raw
    if ($content) {
        $settings = $content | ConvertFrom-Json -AsHashtable
    }
}

# Add hooks configuration
$hooks = @{
    "Stop" = @(
        @{
            "hooks" = @(
                @{
                    "type" = "command"
                    "command" = "powershell -ExecutionPolicy Bypass -File `"scripts/notify.ps1`" -Title `"Claude Code`" -Message `"Task completed`" -Sound success"
                }
            )
        }
    )
    "PermissionRequest" = @(
        @{
            "hooks" = @(
                @{
                    "type" = "command"
                    "command" = "powershell -ExecutionPolicy Bypass -File `"scripts/notify.ps1`" -Title `"Claude Code`" -Message `"Permission needed - check VS Code`" -Sound warning"
                }
            )
        }
    )
}

$settings["hooks"] = $hooks

# Write back
$settings | ConvertTo-Json -Depth 10 | Set-Content $settingsPath
Write-Host "Updated: $settingsPath" -ForegroundColor Green

Write-Host ""
Write-Host "Claude Code notifications configured!" -ForegroundColor Cyan
Write-Host "- Stop event: plays success sound + notification"
Write-Host "- PermissionRequest: plays warning sound + notification"
Write-Host ""
Write-Host "Test it: .\scripts\notify.ps1 -Message 'Test notification' -Sound success" -ForegroundColor Yellow
