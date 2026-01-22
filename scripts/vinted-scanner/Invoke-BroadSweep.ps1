<#
.SYNOPSIS
    Executes a Vinted broad sweep scan using Claude Code.

.DESCRIPTION
    This script runs the broad sweep scan prompt through Claude Code with
    Chrome browser automation. It extracts LEGO listings from Vinted and
    sends them to the process API for arbitrage analysis.

.PARAMETER ApiUrl
    The base URL of the application API. Defaults to http://localhost:3000.

.PARAMETER AuthToken
    The Supabase auth token for API authentication.

.EXAMPLE
    .\Invoke-BroadSweep.ps1 -AuthToken "eyJhbGc..."

.NOTES
    Requires: Claude Code CLI with --chrome support
    Schedule: Task Scheduler - Hourly 08:00-22:00
#>

[CmdletBinding()]
param(
    [Parameter()]
    [string]$ApiUrl = "http://localhost:3000",

    [Parameter(Mandatory = $true)]
    [string]$AuthToken
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

# Load the prompt
$PromptPath = Join-Path $ScriptDir "broad-sweep.md"
if (-not (Test-Path $PromptPath)) {
    Write-Error "Prompt file not found: $PromptPath"
    exit 1
}

$Prompt = Get-Content $PromptPath -Raw

# Check operating hours (08:00 - 22:00)
$CurrentHour = (Get-Date).Hour
if ($CurrentHour -lt 8 -or $CurrentHour -ge 22) {
    Write-Host "Outside operating hours (08:00-22:00). Exiting."
    exit 0
}

# Add random delay before starting (1-30 seconds for hourly variation)
$StartDelay = Get-Random -Minimum 1 -Maximum 30
Write-Host "Waiting $StartDelay seconds before starting..."
Start-Sleep -Seconds $StartDelay

# Execute Claude Code with Chrome
Write-Host "Starting broad sweep scan..."
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
        scanType = "broad_sweep"
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
        Write-Host "Process complete:"
        Write-Host "  - Listings processed: $($Response.summary.listingsProcessed)"
        Write-Host "  - Sets identified: $($Response.summary.setsIdentified)"
        Write-Host "  - Opportunities found: $($Response.summary.opportunitiesFound)"
        Write-Host "  - Near misses: $($Response.summary.nearMissesFound)"
        Write-Host "  - Alerts sent: $($Response.summary.alertsSent)"
    } else {
        Write-Warning "Process failed: $($Response.message)"
    }

} catch {
    Write-Error "Scan failed: $_"

    # Try to report the failure
    try {
        $FailureBody = @{
            scanType = "broad_sweep"
            listings = @()
            captchaDetected = $false
            pagesScanned = 0
            error = $_.Exception.Message
        } | ConvertTo-Json

        Invoke-RestMethod `
            -Uri "$ApiUrl/api/arbitrage/vinted/automation/process" `
            -Method Post `
            -Headers @{
                "Content-Type" = "application/json"
                "Authorization" = "Bearer $AuthToken"
            } `
            -Body $FailureBody
    } catch {
        Write-Warning "Could not report failure to API"
    }

    exit 1
}
