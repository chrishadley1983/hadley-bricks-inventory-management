$port = 3004
$envFile = Join-Path $PSScriptRoot "..\apps\web\.env.local"
$lines = Get-Content $envFile
$serviceKey = (($lines | Where-Object { $_ -match "^SUPABASE_SERVICE_ROLE_KEY=" }) -replace "^SUPABASE_SERVICE_ROLE_KEY=", "").Trim()

$headers = @{
    "Authorization" = "Bearer $serviceKey"
    "Content-Type"  = "application/json"
}

Write-Host "=== Keepa EAN Discovery ===" -ForegroundColor Cyan
$offset = 0
$totalMatched = 0
$totalProcessed = 0
$round = 1

do {
    Write-Host ""
    Write-Host "Round $round (offset=$offset)..." -ForegroundColor Yellow
    $body = @{
        phase  = "ean"
        offset = $offset
    } | ConvertTo-Json

    try {
        $r = Invoke-RestMethod -Uri "http://localhost:$port/api/admin/keepa-discovery" -Method Post -Headers $headers -Body $body -TimeoutSec 300
        Write-Host "  Processed: $($r.stats.processed)" -ForegroundColor White
        Write-Host "  Matched:   $($r.stats.matched)" -ForegroundColor Green
        Write-Host "  Not matched: $($r.stats.not_matched)" -ForegroundColor Gray
        Write-Host "  Tokens used: $($r.stats.tokens_used)" -ForegroundColor Gray
        Write-Host "  Duration:  $($r.stats.duration_ms)ms" -ForegroundColor Gray
        if ($r.stats.errors.Count -gt 0) {
            Write-Host "  Errors: $($r.stats.errors.Count)" -ForegroundColor Red
        }

        $totalMatched += $r.stats.matched
        $totalProcessed += $r.stats.processed

        if ($r.resume -and $r.resume.offset) {
            $offset = $r.resume.offset
            Write-Host "  Resuming at offset $offset..." -ForegroundColor Yellow
        } else {
            Write-Host ""
            Write-Host "=== EAN Discovery Complete ===" -ForegroundColor Green
            Write-Host "  Total processed: $totalProcessed"
            Write-Host "  Total matched:   $totalMatched"
            break
        }
    } catch {
        Write-Host "Error: $($_.Exception.Message)" -ForegroundColor Red
        if ($_.Exception.Response) {
            $reader = [System.IO.StreamReader]::new($_.Exception.Response.GetResponseStream())
            Write-Host $reader.ReadToEnd() -ForegroundColor Red
        }
        break
    }
    $round++
} while ($true)
