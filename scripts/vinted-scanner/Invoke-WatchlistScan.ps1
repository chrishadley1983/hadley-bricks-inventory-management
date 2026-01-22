<#
.SYNOPSIS
    Executes a Vinted watchlist scan for a specific LEGO set using Claude Code.

.DESCRIPTION
    This script runs the watchlist scan prompt through Claude Code with
    Chrome browser automation. It searches for a specific LEGO set number
    on Vinted and sends results to the process API.

.PARAMETER SetNumber
    The LEGO set number to search for (e.g., "75192").

.PARAMETER ApiUrl
    The base URL of the application API. Defaults to http://localhost:3000.

.PARAMETER AuthToken
    The Supabase auth token for API authentication.

.EXAMPLE
    .\Invoke-WatchlistScan.ps1 -SetNumber "75192" -AuthToken "eyJhbGc..."

.NOTES
    Requires: Claude Code CLI with --chrome support
    Schedule: Task Scheduler - Every 5 minutes, rotating through watchlist
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$SetNumber,

    [Parameter()]
    [string]$ApiUrl = "http://localhost:3000",

    [Parameter(Mandatory = $true)]
    [string]$AuthToken
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

# Load the prompt template
$PromptPath = Join-Path $ScriptDir "watchlist-scan.md"
if (-not (Test-Path $PromptPath)) {
    Write-Error "Prompt file not found: $PromptPath"
    exit 1
}

$PromptTemplate = Get-Content $PromptPath -Raw

# Substitute the set number
$Prompt = $PromptTemplate -replace '\{SET_NUMBER\}', $SetNumber

# Check operating hours (08:00 - 22:00)
$CurrentHour = (Get-Date).Hour
if ($CurrentHour -lt 8 -or $CurrentHour -ge 22) {
    Write-Host "Outside operating hours (08:00-22:00). Exiting."
    exit 0
}

# Add random delay (1-5 seconds for quick variation)
$StartDelay = Get-Random -Minimum 1 -Maximum 5
Write-Host "Waiting $StartDelay seconds before starting..."
Start-Sleep -Seconds $StartDelay

# Execute Claude Code with Chrome
Write-Host "Starting watchlist scan for set $SetNumber..."
$StartTime = Get-Date

try {
    # Run Claude Code and capture JSON output
    $RawOutput = claude --chrome --output-format json --prompt $Prompt 2>&1

    # Parse the output to extract the JSON result
    $JsonStart = $RawOutput.IndexOf('{')
    $JsonEnd = $RawOutput.LastIndexOf('}')

    if ($JsonStart -eq -1 -or $JsonEnd -eq -1) {
        Write-Error "No JSON output found from Claude Code"
        exit 1
    }

    $JsonOutput = $RawOutput.Substring($JsonStart, $JsonEnd - $JsonStart + 1)
    $ScanResult = $JsonOutput | ConvertFrom-Json

    $ElapsedMs = ((Get-Date) - $StartTime).TotalMilliseconds
    Write-Host "Scan completed in $([math]::Round($ElapsedMs / 1000, 1)) seconds"

    # Check for CAPTCHA
    if ($ScanResult.captchaDetected) {
        Write-Warning "CAPTCHA detected! Scanner will be auto-paused."
    }

    # Prepare the request body
    $RequestBody = @{
        scanType = "watchlist"
        setNumber = $SetNumber
        listings = $ScanResult.listings
        captchaDetected = $ScanResult.captchaDetected
        pagesScanned = $ScanResult.pagesScanned
        timingDelayMs = [int]$ElapsedMs
    } | ConvertTo-Json -Depth 10

    # Send to process API
    Write-Host "Sending $($ScanResult.listings.Count) listings to process API..."

    $Headers = @{
        "Content-Type" = "application/json"
        "Authorization" = "Bearer $AuthToken"
    }

    $Response = Invoke-RestMethod `
        -Uri "$ApiUrl/api/arbitrage/vinted/automation/process" `
        -Method Post `
        -Headers $Headers `
        -Body $RequestBody

    # Output results
    if ($Response.success) {
        Write-Host "Process complete for set $SetNumber:"
        Write-Host "  - Listings processed: $($Response.summary.listingsProcessed)"
        Write-Host "  - Opportunities found: $($Response.summary.opportunitiesFound)"
        Write-Host "  - Alerts sent: $($Response.summary.alertsSent)"
    } else {
        Write-Warning "Process failed: $($Response.message)"
    }

} catch {
    Write-Error "Scan failed: $_"
    exit 1
}
