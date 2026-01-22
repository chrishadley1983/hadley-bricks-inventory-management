<#
.SYNOPSIS
    Orchestrates watchlist scanning by rotating through all tracked sets.

.DESCRIPTION
    This script fetches the user's watchlist from the API and scans one set
    at a time, rotating through all sets. It maintains state to ensure
    fair coverage across all watchlist items.

.PARAMETER ApiUrl
    The base URL of the application API. Defaults to http://localhost:3000.

.PARAMETER AuthToken
    The Supabase auth token for API authentication.

.PARAMETER ScansPerCycle
    Number of sets to scan before exiting. Defaults to 1 for 5-minute intervals.

.EXAMPLE
    .\Invoke-WatchlistRotation.ps1 -AuthToken "eyJhbGc..." -ScansPerCycle 1

.NOTES
    Requires: Claude Code CLI with --chrome support
    Schedule: Task Scheduler - Every 5 minutes 08:00-22:00

    With 200 sets and 5-minute intervals:
    - Full rotation: 200 × 5 = 1000 minutes = 16.7 hours
    - Each set scanned ~0.8 times per day during operating hours (14 hours)
#>

[CmdletBinding()]
param(
    [Parameter()]
    [string]$ApiUrl = "http://localhost:3000",

    [Parameter(Mandatory = $true)]
    [string]$AuthToken,

    [Parameter()]
    [int]$ScansPerCycle = 1
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

# State file to track rotation position
$StateFile = Join-Path $ScriptDir ".watchlist-rotation-state.json"

# Check operating hours (08:00 - 22:00)
$CurrentHour = (Get-Date).Hour
if ($CurrentHour -lt 8 -or $CurrentHour -ge 22) {
    Write-Host "Outside operating hours (08:00-22:00). Exiting."
    exit 0
}

# Fetch scanner config to check if enabled/paused
Write-Host "Checking scanner status..."
try {
    $Headers = @{
        "Authorization" = "Bearer $AuthToken"
    }

    $Config = Invoke-RestMethod `
        -Uri "$ApiUrl/api/arbitrage/vinted/automation" `
        -Method Get `
        -Headers $Headers

    if (-not $Config.config.enabled) {
        Write-Host "Scanner is disabled. Exiting."
        exit 0
    }

    if ($Config.config.paused) {
        Write-Host "Scanner is paused: $($Config.config.pause_reason)"
        exit 0
    }
} catch {
    Write-Error "Failed to check scanner status: $_"
    exit 1
}

# Fetch the watchlist
Write-Host "Fetching watchlist..."
try {
    $Watchlist = Invoke-RestMethod `
        -Uri "$ApiUrl/api/arbitrage/vinted/watchlist" `
        -Method Get `
        -Headers $Headers

    if ($Watchlist.items.Count -eq 0) {
        Write-Host "Watchlist is empty. Run watchlist refresh first."
        exit 0
    }

    Write-Host "Watchlist contains $($Watchlist.items.Count) sets"
} catch {
    Write-Error "Failed to fetch watchlist: $_"
    exit 1
}

# Load or initialize rotation state
$RotationState = @{
    currentIndex = 0
    lastRunAt = $null
    totalScans = 0
}

if (Test-Path $StateFile) {
    try {
        $RotationState = Get-Content $StateFile -Raw | ConvertFrom-Json
        Write-Host "Resuming from position $($RotationState.currentIndex)"
    } catch {
        Write-Warning "Could not read state file, starting fresh"
    }
}

# Get the sets to scan in this cycle
$SetsToScan = @()
for ($i = 0; $i -lt $ScansPerCycle; $i++) {
    $Index = ($RotationState.currentIndex + $i) % $Watchlist.items.Count
    $SetsToScan += $Watchlist.items[$Index].set_number
}

Write-Host "Scanning sets: $($SetsToScan -join ', ')"

# Scan each set
$ScannedCount = 0
foreach ($SetNumber in $SetsToScan) {
    # Add delay between scans (if multiple)
    if ($ScannedCount -gt 0) {
        $DelaySeconds = Get-Random -Minimum 30 -Maximum 60
        Write-Host "Waiting $DelaySeconds seconds before next scan..."
        Start-Sleep -Seconds $DelaySeconds
    }

    Write-Host "`n--- Scanning set $SetNumber ---"

    try {
        & "$ScriptDir\Invoke-WatchlistScan.ps1" `
            -SetNumber $SetNumber `
            -ApiUrl $ApiUrl `
            -AuthToken $AuthToken

        $ScannedCount++
    } catch {
        Write-Warning "Failed to scan set $SetNumber : $_"

        # Check if it was a CAPTCHA - if so, stop the rotation
        if ($_.Exception.Message -like "*CAPTCHA*") {
            Write-Error "CAPTCHA detected. Stopping rotation."
            break
        }
    }
}

# Update rotation state
$RotationState.currentIndex = ($RotationState.currentIndex + $ScannedCount) % $Watchlist.items.Count
$RotationState.lastRunAt = (Get-Date).ToString("o")
$RotationState.totalScans += $ScannedCount

# Save state
$RotationState | ConvertTo-Json | Set-Content $StateFile -Force

Write-Host "`nRotation complete. Next position: $($RotationState.currentIndex)"
Write-Host "Total scans this session: $ScannedCount"
