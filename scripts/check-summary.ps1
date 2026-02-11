$envFile = Join-Path $PSScriptRoot "..\apps\web\.env.local"
$lines = Get-Content $envFile
$url = ($lines | Where-Object { $_ -match "^NEXT_PUBLIC_SUPABASE_URL=(.+)$" }) -replace "^NEXT_PUBLIC_SUPABASE_URL=", ""
$key = ($lines | Where-Object { $_ -match "^SUPABASE_SERVICE_ROLE_KEY=(.+)$" }) -replace "^SUPABASE_SERVICE_ROLE_KEY=", ""

$headers = @{ "apikey" = $key; "Authorization" = "Bearer $key" }

Write-Host "=== Current State ===" -ForegroundColor Cyan

# Seeded ASIN counts
$found = (Invoke-RestMethod -Uri "$url/rest/v1/seeded_asins?discovery_status=eq.found&select=id&limit=1" -Headers ($headers + @{ "Prefer" = "count=exact" })).Count
# Use the view instead
$summary = Invoke-RestMethod -Uri "$url/rest/v1/seeded_discovery_summary?select=*" -Headers $headers
Write-Host "seeded_asins found:     $($summary.found_count)"
Write-Host "seeded_asins not_found: $($summary.not_found_count)"
Write-Host "seeded_asins total:     $($summary.total_count)"

# ASINs with price snapshots
$withPrices = Invoke-RestMethod -Uri "$url/rest/v1/price_snapshots?source=eq.keepa_amazon_buybox&select=set_num&limit=10000" -Headers $headers
$uniqueSets = ($withPrices | Select-Object -ExpandProperty set_num -Unique).Count
Write-Host "Sets with Keepa price data: $uniqueSets"

# ASINs linked in brickset_sets
$linked = Invoke-RestMethod -Uri "$url/rest/v1/brickset_sets?amazon_asin=not.is.null&select=id&limit=10000" -Headers $headers
Write-Host "brickset_sets with amazon_asin: $($linked.Count)"

# Today's new discoveries
$today = (Get-Date).ToString("yyyy-MM-dd")
$todayMatches = Invoke-RestMethod -Uri "$url/rest/v1/seeded_asins?last_discovery_attempt_at=gte.$($today)T00:00:00&discovery_status=eq.found&select=id&limit=10000" -Headers $headers
Write-Host "New ASINs discovered today: $($todayMatches.Count)"
