$envFile = Join-Path $PSScriptRoot "..\apps\web\.env.local"
$lines = Get-Content $envFile
$url = ($lines | Where-Object { $_ -match "^NEXT_PUBLIC_SUPABASE_URL=(.+)$" }) -replace "^NEXT_PUBLIC_SUPABASE_URL=", ""
$key = ($lines | Where-Object { $_ -match "^SUPABASE_SERVICE_ROLE_KEY=(.+)$" }) -replace "^SUPABASE_SERVICE_ROLE_KEY=", ""

$headers = @{
    "apikey" = $key
    "Authorization" = "Bearer $key"
}

# Check for recent discovery attempts
Write-Host "=== Rows with recent last_discovery_attempt_at ===" -ForegroundColor Cyan
$recent = Invoke-RestMethod -Uri "$url/rest/v1/seeded_asins?last_discovery_attempt_at=gte.2026-02-08T00:00:00&select=id,asin,discovery_status,match_method,last_discovery_attempt_at&limit=10" -Headers $headers
Write-Host "Count: $($recent.Count)"
foreach ($r in $recent) {
    Write-Host "  id=$($r.id) asin=$($r.asin) status=$($r.discovery_status) method=$($r.match_method) at=$($r.last_discovery_attempt_at)" -ForegroundColor Gray
}

# Try a manual test upsert to see if it works
Write-Host ""
Write-Host "=== Testing manual upsert ===" -ForegroundColor Cyan

# First, find a brickset_set with EAN that has no 'found' seeded_asins row
$testSet = Invoke-RestMethod -Uri "$url/rest/v1/brickset_sets?ean=not.is.null&select=id,set_number,ean&limit=1&order=set_number" -Headers $headers
$testSetId = $testSet[0].id
Write-Host "Test set: $($testSet[0].set_number) (id=$testSetId, ean=$($testSet[0].ean))"

# Check if it has a seeded_asins row
$existing = Invoke-RestMethod -Uri "$url/rest/v1/seeded_asins?brickset_set_id=eq.$testSetId&select=id,asin,discovery_status,match_method" -Headers $headers
Write-Host "Existing seeded_asins row: $($existing | ConvertTo-Json -Compress)"

# Try upserting a test row
Write-Host ""
Write-Host "Testing upsert..." -ForegroundColor Yellow
$testBody = @(
    @{
        brickset_set_id = $testSetId
        discovery_status = "found"
        match_method = "ean"
        match_confidence = 100
        asin = "TESTTEST01"
        amazon_title = "TEST - will revert"
        last_discovery_attempt_at = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
        discovery_attempts = 1
    }
) | ConvertTo-Json

$upsertHeaders = $headers + @{
    "Content-Type" = "application/json"
    "Prefer" = "resolution=merge-duplicates"
}

try {
    $result = Invoke-RestMethod -Uri "$url/rest/v1/seeded_asins?on_conflict=brickset_set_id" -Method Post -Headers $upsertHeaders -Body $testBody
    Write-Host "Upsert SUCCESS" -ForegroundColor Green

    # Check it wrote
    $check = Invoke-RestMethod -Uri "$url/rest/v1/seeded_asins?brickset_set_id=eq.$testSetId&select=id,asin,discovery_status,match_method,last_discovery_attempt_at" -Headers $headers
    Write-Host "After upsert: $($check | ConvertTo-Json -Compress)"

    # Revert
    $revertBody = @(
        @{
            brickset_set_id = $testSetId
            discovery_status = if ($existing.Count -gt 0) { $existing[0].discovery_status } else { "pending" }
            match_method = if ($existing.Count -gt 0) { $existing[0].match_method } else { $null }
            asin = if ($existing.Count -gt 0) { $existing[0].asin } else { $null }
            amazon_title = $null
        }
    ) | ConvertTo-Json
    Invoke-RestMethod -Uri "$url/rest/v1/seeded_asins?on_conflict=brickset_set_id" -Method Post -Headers $upsertHeaders -Body $revertBody | Out-Null
    Write-Host "Reverted" -ForegroundColor Gray
} catch {
    Write-Host "Upsert FAILED: $($_.Exception.Message)" -ForegroundColor Red
    if ($_.Exception.Response) {
        $reader = [System.IO.StreamReader]::new($_.Exception.Response.GetResponseStream())
        Write-Host $reader.ReadToEnd() -ForegroundColor Red
    }
}
