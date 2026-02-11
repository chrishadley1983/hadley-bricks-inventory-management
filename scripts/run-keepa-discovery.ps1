# Keepa ASIN Discovery Runner
# Calls the /api/admin/keepa-discovery endpoint in a loop,
# resuming from cursor until complete.
#
# Usage:
#   .\scripts\run-keepa-discovery.ps1 -Phase ean
#   .\scripts\run-keepa-discovery.ps1 -Phase finder
#   .\scripts\run-keepa-discovery.ps1 -Phase ean -DryRun
#   .\scripts\run-keepa-discovery.ps1 -Phase ean -BaseUrl https://hadley-bricks.vercel.app

param(
    [Parameter(Mandatory=$true)]
    [ValidateSet('ean','finder')]
    [string]$Phase,

    [switch]$DryRun,

    [string]$BaseUrl = "http://localhost:3000",

    [int]$Limit = 0
)

# Auth: reads SUPABASE_SERVICE_ROLE_KEY from .env.local automatically
$envFile = Join-Path $PSScriptRoot "..\apps\web\.env.local"
$serviceRoleKey = $null

if (Test-Path $envFile) {
    $match = Select-String -Path $envFile -Pattern "^SUPABASE_SERVICE_ROLE_KEY=(.+)$"
    if ($match) {
        $serviceRoleKey = $match.Matches[0].Groups[1].Value.Trim()
    }
}

if (-not $serviceRoleKey) {
    Write-Host "Could not find SUPABASE_SERVICE_ROLE_KEY in apps/web/.env.local" -ForegroundColor Red
    exit 1
}

Write-Host "Auth: using service role key from .env.local" -ForegroundColor Gray

$url = "$BaseUrl/api/admin/keepa-discovery"
$headers = @{
    "Content-Type" = "application/json"
    "Authorization" = "Bearer $serviceRoleKey"
}

# Cumulative stats
$totalProcessed = 0
$totalMatched = 0
$totalNotMatched = 0
$totalTokens = 0
$totalDuration = 0
$iteration = 0

# Resume cursors
$offset = 0
$finderPage = 0

$startTime = Get-Date

Write-Host ""
Write-Host "=== Keepa ASIN Discovery: $Phase phase ===" -ForegroundColor Cyan
if ($DryRun) { Write-Host "(DRY RUN - no writes)" -ForegroundColor Yellow }
Write-Host ""

do {
    $iteration++

    $body = @{
        phase = $Phase
        limit = $Limit
        dryRun = [bool]$DryRun
    }

    if ($Phase -eq 'ean') {
        $body.offset = $offset
    } else {
        $body.finderPage = $finderPage
    }

    $jsonBody = $body | ConvertTo-Json -Compress

    Write-Host "[$iteration] Calling API (offset=$offset, finderPage=$finderPage)..." -ForegroundColor Gray

    try {
        $response = Invoke-RestMethod -Uri $url -Method Post -Headers $headers -Body $jsonBody -TimeoutSec 300
    } catch {
        Write-Host "  ERROR: $($_.Exception.Message)" -ForegroundColor Red
        if ($_.Exception.Response) {
            $reader = [System.IO.StreamReader]::new($_.Exception.Response.GetResponseStream())
            $errBody = $reader.ReadToEnd()
            Write-Host "  Response: $errBody" -ForegroundColor Red
        }
        Write-Host "  Waiting 30s before retry..." -ForegroundColor Yellow
        Start-Sleep -Seconds 30
        continue
    }

    # Accumulate stats
    $stats = $response.stats
    $totalProcessed += $stats.processed
    $totalMatched += $stats.matched
    $totalNotMatched += $stats.not_matched
    $totalTokens += $stats.tokens_used
    $totalDuration += $stats.duration_ms

    # Calculate match rate
    $matchRate = if ($totalProcessed -gt 0) { [math]::Round(($totalMatched / $totalProcessed) * 100, 1) } else { 0 }
    $elapsed = ((Get-Date) - $startTime).ToString("hh\:mm\:ss")

    # Print iteration stats
    Write-Host "  This batch: +$($stats.matched) matched, +$($stats.not_matched) missed, $($stats.tokens_used) tokens, $([math]::Round($stats.duration_ms/1000))s" -ForegroundColor White

    # Print cumulative stats
    Write-Host "  TOTAL: $totalProcessed processed | $totalMatched matched ($matchRate%) | $totalTokens tokens | $elapsed elapsed" -ForegroundColor Green

    # Check for resume cursor (handle null, empty string, or no properties)
    $resume = $response.resume
    $hasResume = $resume -and ($resume.PSObject.Properties.Name.Count -gt 0)
    if (-not $hasResume) {
        Write-Host ""
        Write-Host "=== COMPLETE ===" -ForegroundColor Green
        break
    }

    # Update cursors
    if ($resume.offset) { $offset = $resume.offset }
    if ($resume.finderPage) { $finderPage = $resume.finderPage }

    Write-Host "  Resuming from offset=$offset, finderPage=$finderPage..." -ForegroundColor Gray
    Write-Host ""

} while ($true)

# Final summary
Write-Host ""
Write-Host "=== Final Summary ===" -ForegroundColor Cyan
Write-Host "  Phase:       $Phase"
Write-Host "  Processed:   $totalProcessed"
Write-Host "  Matched:     $totalMatched ($matchRate%)"
Write-Host "  Not matched: $totalNotMatched"
Write-Host "  Tokens used: $totalTokens"
Write-Host "  Iterations:  $iteration"
Write-Host "  Total time:  $elapsed"
if ($DryRun) { Write-Host "  (DRY RUN - nothing written)" -ForegroundColor Yellow }
Write-Host ""
