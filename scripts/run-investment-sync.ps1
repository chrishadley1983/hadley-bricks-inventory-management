$envFile = Join-Path $PSScriptRoot "..\apps\web\.env.local"
$lines = Get-Content $envFile
$cronMatch = Select-String -Path $envFile -Pattern "^CRON_SECRET=(.+)$"
$cronSecret = if ($cronMatch) { $cronMatch.Matches[0].Groups[1].Value.Trim() } else { "" }

if (-not $cronSecret) {
    Write-Host "CRON_SECRET not found in .env.local" -ForegroundColor Red
    exit 1
}

$headers = @{
    "Authorization" = "Bearer $cronSecret"
}

Write-Host "Running investment sync (ASIN linkage + classification + price alerts)..." -ForegroundColor Cyan

try {
    $r = Invoke-RestMethod -Uri "http://localhost:3000/api/cron/investment-sync" -Method Post -Headers $headers -TimeoutSec 300
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
