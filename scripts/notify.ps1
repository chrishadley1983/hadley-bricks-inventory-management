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
