$envFile = Join-Path $PSScriptRoot "..\apps\web\.env.local"
$lines = Get-Content $envFile
$url = (($lines | Where-Object { $_ -match "^NEXT_PUBLIC_SUPABASE_URL=" } | Select-Object -First 1) -replace "^NEXT_PUBLIC_SUPABASE_URL=", "").Trim()
$key = ((Select-String -Path $envFile -Pattern "^SUPABASE_SERVICE_ROLE_KEY=(.+)$").Matches[0].Groups[1].Value).Trim()

$headers = @{
    "apikey" = $key
    "Authorization" = "Bearer $key"
    "Content-Type" = "application/json"
}

Write-Host "Linking ASINs from seeded_asins to brickset_sets via SQL..." -ForegroundColor Cyan

# Use Supabase RPC to run a direct SQL update
$sql = @"
UPDATE brickset_sets bs
SET amazon_asin = sa.asin,
    has_amazon_listing = true
FROM seeded_asins sa
WHERE sa.brickset_set_id = bs.id
  AND sa.discovery_status = 'found'
  AND sa.asin IS NOT NULL
  AND sa.match_confidence >= 60
  AND (bs.amazon_asin IS NULL OR bs.amazon_asin != sa.asin)
"@

# We'll use the management API to run SQL
$mgmtUrl = "https://modjoikyuhqzouxvieua.supabase.co/rest/v1/rpc/exec_sql"

# Alternative: use individual batch updates via REST
Write-Host "Fetching found ASINs..." -ForegroundColor Gray
$pageSize = 1000
$page = 0
$totalUpdated = 0
$totalErrors = 0

do {
    $from = $page * $pageSize
    $to = ($page + 1) * $pageSize - 1
    $data = Invoke-RestMethod -Uri "$url/rest/v1/seeded_asins?discovery_status=eq.found&asin=not.is.null&match_confidence=gte.60&select=brickset_set_id,asin&offset=$from&limit=$pageSize" -Headers $headers

    if ($data.Count -eq 0) { break }

    Write-Host "  Page $page`: $($data.Count) ASINs to link..." -ForegroundColor Gray

    # Update each set via PATCH
    foreach ($row in $data) {
        $setId = $row.brickset_set_id
        $asin = $row.asin
        $updateBody = "{`"amazon_asin`":`"$asin`",`"has_amazon_listing`":true}"

        try {
            Invoke-RestMethod -Uri "$url/rest/v1/brickset_sets?id=eq.$setId" -Method Patch -Headers $headers -Body $updateBody | Out-Null
            $totalUpdated++
        } catch {
            $totalErrors++
        }
    }

    Write-Host "    Updated $totalUpdated so far ($totalErrors errors)" -ForegroundColor White
    $page++
} while ($data.Count -eq $pageSize)

Write-Host ""
Write-Host "=== Complete ===" -ForegroundColor Green
Write-Host "  Linked: $totalUpdated"
Write-Host "  Errors: $totalErrors"
