$envFile = Join-Path $PSScriptRoot "..\apps\web\.env.local"
$lines = Get-Content $envFile
$url = ($lines | Where-Object { $_ -match "^NEXT_PUBLIC_SUPABASE_URL=(.+)$" }) -replace "^NEXT_PUBLIC_SUPABASE_URL=", ""
$key = ($lines | Where-Object { $_ -match "^SUPABASE_SERVICE_ROLE_KEY=(.+)$" }) -replace "^SUPABASE_SERVICE_ROLE_KEY=", ""

$headers = @{
    "apikey" = $key
    "Authorization" = "Bearer $key"
}

Write-Host "=== Rows updated in last 5 minutes ===" -ForegroundColor Cyan
$fiveMinAgo = (Get-Date).AddMinutes(-5).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
$recent = Invoke-RestMethod -Uri "$url/rest/v1/seeded_asins?updated_at=gte.$fiveMinAgo&select=asin,discovery_status,match_method,match_confidence,amazon_title,updated_at,last_discovery_attempt_at&limit=20&order=updated_at.desc" -Headers $headers
Write-Host "Count: $($recent.Count)"
foreach ($r in $recent) {
    Write-Host "  ASIN=$($r.asin) status=$($r.discovery_status) method=$($r.match_method) conf=$($r.match_confidence)" -ForegroundColor White
    Write-Host "    title=$($r.amazon_title)" -ForegroundColor Gray
    Write-Host "    updated=$($r.updated_at) attempt=$($r.last_discovery_attempt_at)" -ForegroundColor Gray
}
