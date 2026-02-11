$envFile = Join-Path $PSScriptRoot "..\apps\web\.env.local"
$lines = Get-Content $envFile
$url = ($lines | Where-Object { $_ -match "^NEXT_PUBLIC_SUPABASE_URL=(.+)$" }) -replace "^NEXT_PUBLIC_SUPABASE_URL=", ""
$key = ($lines | Where-Object { $_ -match "^SUPABASE_SERVICE_ROLE_KEY=(.+)$" }) -replace "^SUPABASE_SERVICE_ROLE_KEY=", ""

$headers = @{
    "apikey" = $key
    "Authorization" = "Bearer $key"
    "Content-Type" = "application/json"
}

Write-Host "=== EAN Discovery Results (from real run) ===" -ForegroundColor Cyan

# Count EAN matches written by our run
$r = Invoke-RestMethod -Uri "$url/rest/v1/seeded_asins?match_method=eq.ean&select=count" -Headers ($headers + @{ "Prefer" = "count=exact" }) -Method Head -ResponseHeadersVariable rh
Write-Host "Total EAN-matched rows: $($rh['content-range'])" -ForegroundColor White

# Sample 10 EAN matches with set details
$sample = Invoke-RestMethod -Uri "$url/rest/v1/seeded_asins?match_method=eq.ean&discovery_status=eq.found&select=asin,amazon_title,match_confidence,brickset_set_id&limit=10&order=updated_at.desc" -Headers $headers
Write-Host ""
Write-Host "--- Latest 10 EAN matches ---" -ForegroundColor Yellow
foreach ($row in $sample) {
    # Get brickset set info
    $bs = Invoke-RestMethod -Uri "$url/rest/v1/brickset_sets?id=eq.$($row.brickset_set_id)&select=set_number,set_name,ean" -Headers $headers
    $set = $bs[0]
    Write-Host "  ASIN: $($row.asin) | Set: $($set.set_number) - $($set.set_name)" -ForegroundColor White
    Write-Host "    Amazon: $($row.amazon_title)" -ForegroundColor Gray
    Write-Host "    EAN: $($set.ean) | Confidence: $($row.match_confidence)" -ForegroundColor Gray
    Write-Host ""
}

Write-Host "=== Discovery Status Summary ===" -ForegroundColor Cyan
$summary = Invoke-RestMethod -Uri "$url/rest/v1/seeded_discovery_summary?select=*" -Headers $headers
$summary | Format-List
