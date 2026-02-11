$envFile = Join-Path $PSScriptRoot "..\apps\web\.env.local"
$url = ((Select-String -Path $envFile -Pattern "^NEXT_PUBLIC_SUPABASE_URL=(.+)$").Matches[0].Groups[1].Value).Trim()
$key = ((Select-String -Path $envFile -Pattern "^SUPABASE_SERVICE_ROLE_KEY=(.+)$").Matches[0].Groups[1].Value).Trim()

$headers = @{ "apikey" = $key; "Authorization" = "Bearer $key" }

$linked = Invoke-RestMethod -Uri "$url/rest/v1/brickset_sets?has_amazon_listing=is.true&select=id&limit=10000" -Headers $headers
Write-Host "brickset_sets with has_amazon_listing=true: $($linked.Count)"
