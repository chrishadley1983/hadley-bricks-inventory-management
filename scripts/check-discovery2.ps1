$envFile = Join-Path $PSScriptRoot "..\apps\web\.env.local"
$lines = Get-Content $envFile
$url = ($lines | Where-Object { $_ -match "^NEXT_PUBLIC_SUPABASE_URL=(.+)$" }) -replace "^NEXT_PUBLIC_SUPABASE_URL=", ""
$key = ($lines | Where-Object { $_ -match "^SUPABASE_SERVICE_ROLE_KEY=(.+)$" }) -replace "^SUPABASE_SERVICE_ROLE_KEY=", ""

$headers = @{
    "apikey" = $key
    "Authorization" = "Bearer $key"
}

Write-Host "=== Checking recent writes ===" -ForegroundColor Cyan

# Check for rows updated today
$today = (Get-Date).ToString("yyyy-MM-dd")
$recent = Invoke-RestMethod -Uri "$url/rest/v1/seeded_asins?updated_at=gte.$($today)T00:00:00&select=asin,discovery_status,match_method,match_confidence,amazon_title,updated_at&limit=20&order=updated_at.desc" -Headers $headers
Write-Host "Rows updated today ($today): $($recent.Count)" -ForegroundColor White
foreach ($row in $recent | Select-Object -First 5) {
    Write-Host "  ASIN=$($row.asin) status=$($row.discovery_status) method=$($row.match_method) conf=$($row.match_confidence) title=$($row.amazon_title)" -ForegroundColor Gray
}

Write-Host ""
Write-Host "=== Match method breakdown ===" -ForegroundColor Cyan
$methods = @('ean', 'upc', 'title_exact', 'title_fuzzy')
foreach ($m in $methods) {
    $count = Invoke-RestMethod -Uri "$url/rest/v1/seeded_asins?match_method=eq.$m&discovery_status=eq.found&select=id&limit=1" -Headers ($headers + @{ "Prefer" = "count=exact"; "Range-Unit" = "items"; "Range" = "0-0" })
    # Just show the result array length as a proxy
    Write-Host "  $m matches (sample): checking..." -ForegroundColor Gray
}

# Better count approach
Write-Host ""
Write-Host "=== Counts by match_method ===" -ForegroundColor Cyan
$all = Invoke-RestMethod -Uri "$url/rest/v1/rpc/initialize_seeded_asins" -Method Post -Headers ($headers + @{ "Content-Type" = "application/json" }) -Body "{}" -ErrorAction SilentlyContinue
Write-Host "(Also checked for new sets to initialize)" -ForegroundColor Gray

# Count by querying each status
$found = Invoke-RestMethod -Uri "$url/rest/v1/seeded_asins?discovery_status=eq.found&select=match_method&limit=10000" -Headers $headers
$methodCounts = $found | Group-Object -Property match_method | Select-Object Name, Count
Write-Host ""
foreach ($g in $methodCounts) {
    Write-Host "  $($g.Name): $($g.Count)" -ForegroundColor White
}

Write-Host ""
Write-Host "=== Sets with EAN not in seeded_asins ===" -ForegroundColor Cyan
# Check how many brickset_sets with EAN have no seeded_asins row at all
$setsWithEan = Invoke-RestMethod -Uri "$url/rest/v1/brickset_sets?ean=not.is.null&select=id&limit=10000" -Headers $headers
Write-Host "brickset_sets with EAN: $($setsWithEan.Count)" -ForegroundColor White
