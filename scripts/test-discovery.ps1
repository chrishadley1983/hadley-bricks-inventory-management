$envFile = Join-Path $PSScriptRoot "..\apps\web\.env.local"
$match = Select-String -Path $envFile -Pattern "^SUPABASE_SERVICE_ROLE_KEY=(.+)$"
$key = $match.Matches[0].Groups[1].Value.Trim()

$headers = @{
    "Content-Type" = "application/json"
    "Authorization" = "Bearer $key"
}

$body = '{"phase":"ean","dryRun":true,"limit":5}'

Write-Host "Calling keepa-discovery with limit=5 dryRun=true..." -ForegroundColor Cyan

try {
    $r = Invoke-RestMethod -Uri "http://localhost:3000/api/admin/keepa-discovery" -Method Post -Headers $headers -Body $body -TimeoutSec 120
    $r | ConvertTo-Json -Depth 5
} catch {
    Write-Host "Error: $($_.Exception.Message)" -ForegroundColor Red
    if ($_.Exception.Response) {
        $reader = [System.IO.StreamReader]::new($_.Exception.Response.GetResponseStream())
        Write-Host $reader.ReadToEnd() -ForegroundColor Red
    }
}
