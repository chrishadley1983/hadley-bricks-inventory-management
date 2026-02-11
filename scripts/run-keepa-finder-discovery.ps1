$port = 3004
$envFile = Join-Path $PSScriptRoot "..\apps\web\.env.local"
$lines = Get-Content $envFile
$serviceKey = (($lines | Where-Object { $_ -match "^SUPABASE_SERVICE_ROLE_KEY=" }) -replace "^SUPABASE_SERVICE_ROLE_KEY=", "").Trim()

$headers = @{
    "Authorization" = "Bearer $serviceKey"
    "Content-Type"  = "application/json"
}

Write-Host "=== Keepa Product Finder Discovery ===" -ForegroundColor Cyan
$finderPage = 0
$totalMatched = 0
$totalProcessed = 0
$totalTokens = 0
$round = 1

do {
    Write-Host ""
    Write-Host "Round $round (finderPage=$finderPage)..." -ForegroundColor Yellow
    $body = @{
        phase      = "finder"
        finderPage = $finderPage
    } | ConvertTo-Json

    try {
        $r = Invoke-RestMethod -Uri "http://localhost:$port/api/admin/keepa-discovery" -Method Post -Headers $headers -Body $body -TimeoutSec 300
        Write-Host "  Processed: $($r.stats.processed)" -ForegroundColor White
        Write-Host "  Matched:   $($r.stats.matched)" -ForegroundColor Green
        Write-Host "  Not matched: $($r.stats.not_matched)" -ForegroundColor Gray
        Write-Host "  Tokens used: $($r.stats.tokens_used)" -ForegroundColor Gray
        Write-Host "  Duration:  $([math]::Round($r.stats.duration_ms / 1000))s" -ForegroundColor Gray
        if ($r.stats.errors.Count -gt 0) {
            Write-Host "  Errors: $($r.stats.errors.Count)" -ForegroundColor Red
        }

        $totalMatched += $r.stats.matched
        $totalProcessed += $r.stats.processed
        $totalTokens += $r.stats.tokens_used

        if ($r.resume -and $null -ne $r.resume.finderPage) {
            $finderPage = $r.resume.finderPage
            Write-Host "  Cumulative: processed=$totalProcessed matched=$totalMatched tokens=$totalTokens" -ForegroundColor Cyan
            Write-Host "  Resuming at finderPage $finderPage..." -ForegroundColor Yellow
        } else {
            Write-Host ""
            Write-Host "=== Product Finder Discovery Complete ===" -ForegroundColor Green
            Write-Host "  Total processed: $totalProcessed"
            Write-Host "  Total matched:   $totalMatched"
            Write-Host "  Total tokens:    $totalTokens"
            break
        }
    } catch {
        Write-Host "Error: $($_.Exception.Message)" -ForegroundColor Red
        if ($_.Exception.Response) {
            $reader = [System.IO.StreamReader]::new($_.Exception.Response.GetResponseStream())
            Write-Host $reader.ReadToEnd() -ForegroundColor Red
        }
        Write-Host ""
        Write-Host "Stopped at finderPage=$finderPage. Re-run to resume." -ForegroundColor Yellow
        break
    }
    $round++
} while ($true)
