$port = 3004

# Check if server responds to a simple request
try {
    $r = Invoke-WebRequest -Uri "http://localhost:$port/" -TimeoutSec 5 -ErrorAction Stop
    Write-Host "Server responded: $($r.StatusCode)" -ForegroundColor Green
} catch {
    Write-Host "Server check failed: $($_.Exception.Message)" -ForegroundColor Red
}

# Try the keepa-import endpoint with a dry-run to see if it's busy
try {
    $envFile = Join-Path $PSScriptRoot "..\apps\web\.env.local"
    $lines = Get-Content $envFile
    $serviceKey = (($lines | Where-Object { $_ -match "^SUPABASE_SERVICE_ROLE_KEY=" }) -replace "^SUPABASE_SERVICE_ROLE_KEY=", "").Trim()

    $headers = @{
        "Authorization" = "Bearer $serviceKey"
        "Content-Type"  = "application/json"
    }

    $body = '{"asins":["B07FQ6P8X5"],"dryRun":true}'
    $r2 = Invoke-RestMethod -Uri "http://localhost:$port/api/admin/keepa-import" -Method Post -Headers $headers -Body $body -TimeoutSec 10
    Write-Host "Import endpoint responds: $($r2.message)" -ForegroundColor Green
} catch {
    Write-Host "Import endpoint busy/error: $($_.Exception.Message)" -ForegroundColor Yellow
}
