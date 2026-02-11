$envFile = Join-Path $PSScriptRoot "..\apps\web\.env.local"
$lines = Get-Content $envFile
$url = (($lines | Where-Object { $_ -match "^NEXT_PUBLIC_SUPABASE_URL=" }) -replace "^NEXT_PUBLIC_SUPABASE_URL=", "").Trim()
$key = (($lines | Where-Object { $_ -match "^SUPABASE_SERVICE_ROLE_KEY=" }) -replace "^SUPABASE_SERVICE_ROLE_KEY=", "").Trim()

$headers = @{ "apikey" = $key; "Authorization" = "Bearer $key" }

Write-Host "=== Final Import State ===" -ForegroundColor Cyan

# Count total price_snapshots
$r = Invoke-WebRequest -Uri "$url/rest/v1/price_snapshots?select=id&limit=1" -Headers ($headers + @{ "Prefer" = "count=exact" })
$psTotal = [int]($r.Headers["content-range"] -split "/" | Select-Object -Last 1)
Write-Host "price_snapshots total rows: $psTotal"

# Get distinct set_nums by paginating
$allSetNums = @{}
$pageSize = 1000
$offset = 0
$hasMore = $true

while ($hasMore) {
    $data = Invoke-RestMethod -Uri "$url/rest/v1/price_snapshots?source=eq.keepa_amazon_buybox&select=set_num&order=set_num&offset=$offset&limit=$pageSize" -Headers $headers
    if ($data.Count -eq 0) { $hasMore = $false; break }
    foreach ($row in $data) { $allSetNums[$row.set_num] = $true }
    $hasMore = $data.Count -eq $pageSize
    $offset += $pageSize
    if ($offset % 10000 -eq 0) { Write-Host "  Scanned $offset rows, $($allSetNums.Count) unique sets so far..." -ForegroundColor Gray }
}

Write-Host "Unique sets with Keepa price data: $($allSetNums.Count)" -ForegroundColor Green

# brickset_sets with amazon_asin
$r2 = Invoke-WebRequest -Uri "$url/rest/v1/brickset_sets?amazon_asin=not.is.null&select=id&limit=1" -Headers ($headers + @{ "Prefer" = "count=exact" })
$withAsin = [int]($r2.Headers["content-range"] -split "/" | Select-Object -Last 1)
Write-Host "brickset_sets with amazon_asin: $withAsin"

Write-Host ""
Write-Host "Coverage: $($allSetNums.Count) / $withAsin sets have price history ($([math]::Round($allSetNums.Count / $withAsin * 100, 1))%)" -ForegroundColor Green
Write-Host "Gap: $($withAsin - $allSetNums.Count) sets linked but no price history yet" -ForegroundColor Yellow
