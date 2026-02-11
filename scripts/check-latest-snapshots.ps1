$envFile = Join-Path $PSScriptRoot "..\apps\web\.env.local"
$lines = Get-Content $envFile
$url = (($lines | Where-Object { $_ -match "^NEXT_PUBLIC_SUPABASE_URL=" }) -replace "^NEXT_PUBLIC_SUPABASE_URL=", "").Trim()
$key = (($lines | Where-Object { $_ -match "^SUPABASE_SERVICE_ROLE_KEY=" }) -replace "^SUPABASE_SERVICE_ROLE_KEY=", "").Trim()

$headers = @{ "apikey" = $key; "Authorization" = "Bearer $key" }

# Get the 5 most recently created rows by created_at
$recent = Invoke-RestMethod -Uri "$url/rest/v1/price_snapshots?source=eq.keepa_amazon_buybox&select=set_num,created_at&order=created_at.desc&limit=5" -Headers $headers
Write-Host "Latest 5 snapshots (by created_at desc):"
foreach ($row in $recent) {
    Write-Host "  set=$($row.set_num) created=$($row.created_at)"
}

# Paginate to get all batch 3 rows
$batch3Start = "2026-02-09T11:39:00Z"
$pageSize = 1000
$offset = 0
$batch3Sets = @{}
$totalRows = 0
$hasMore = $true

while ($hasMore) {
    $data = Invoke-RestMethod -Uri "$url/rest/v1/price_snapshots?source=eq.keepa_amazon_buybox&created_at=gte.$batch3Start&select=set_num&order=created_at&offset=$offset&limit=$pageSize" -Headers $headers
    if ($data.Count -eq 0) { $hasMore = $false; break }
    $totalRows += $data.Count
    foreach ($row in $data) { $batch3Sets[$row.set_num] = $true }
    $hasMore = $data.Count -eq $pageSize
    $offset += $pageSize
}

Write-Host ""
Write-Host "=== Batch 3 Progress (since 11:39 UTC) ==="
Write-Host "New sets imported: $($batch3Sets.Count)"
Write-Host "New rows imported: $totalRows"

# Count since last 5 minutes
$fiveMinAgo = (Get-Date).AddMinutes(-5).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
$veryRecent = Invoke-RestMethod -Uri "$url/rest/v1/price_snapshots?source=eq.keepa_amazon_buybox&created_at=gte.$fiveMinAgo&select=set_num&limit=1000" -Headers $headers
Write-Host "Rows in last 5 min: $($veryRecent.Count)"
