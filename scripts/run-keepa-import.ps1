$port = 3004
$envFile = Join-Path $PSScriptRoot "..\apps\web\.env.local"
$lines = Get-Content $envFile
$serviceKey = (($lines | Where-Object { $_ -match "^SUPABASE_SERVICE_ROLE_KEY=" }) -replace "^SUPABASE_SERVICE_ROLE_KEY=", "").Trim()

$headers = @{
    "Authorization" = "Bearer $serviceKey"
    "Content-Type"  = "application/json"
}

Write-Host "=== Keepa Price Import (Retired Sets) ===" -ForegroundColor Cyan

$body = @{
    retiredSets = $true
} | ConvertTo-Json

try {
    $r = Invoke-RestMethod -Uri "http://localhost:$port/api/admin/keepa-import" -Method Post -Headers $headers -Body $body -TimeoutSec 3600
    Write-Host ""
    Write-Host "Response:" -ForegroundColor Green
    Write-Host "  Total ASINs:      $($r.stats.total_asins)"
    Write-Host "  Snapshots:        $($r.stats.total_snapshots_imported)"
    Write-Host "  Successful:       $($r.stats.successful)" -ForegroundColor Green
    Write-Host "  Failed:           $($r.stats.failed)" -ForegroundColor $(if ($r.stats.failed -gt 0) { "Red" } else { "Gray" })
    Write-Host "  Skipped (no data):$($r.stats.skipped_no_data)" -ForegroundColor Gray
    Write-Host "  Duration:         $([math]::Round($r.stats.duration_ms / 1000))s" -ForegroundColor Gray
} catch {
    Write-Host "Error: $($_.Exception.Message)" -ForegroundColor Red
    if ($_.Exception.Response) {
        $reader = [System.IO.StreamReader]::new($_.Exception.Response.GetResponseStream())
        Write-Host $reader.ReadToEnd() -ForegroundColor Red
    }
}
