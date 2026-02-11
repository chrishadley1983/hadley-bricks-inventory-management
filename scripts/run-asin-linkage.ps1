$port = 3004

Write-Host "Running investment sync (ASIN linkage + classification + price alerts)..." -ForegroundColor Cyan

try {
    $r = Invoke-RestMethod -Uri "http://localhost:$port/api/cron/investment-sync" -Method Post -TimeoutSec 600
    Write-Host ""
    Write-Host "Response:" -ForegroundColor Green
    $r | ConvertTo-Json -Depth 5
} catch {
    Write-Host "Error: $($_.Exception.Message)" -ForegroundColor Red
    if ($_.Exception.Response) {
        $reader = [System.IO.StreamReader]::new($_.Exception.Response.GetResponseStream())
        Write-Host $reader.ReadToEnd() -ForegroundColor Red
    }
}
