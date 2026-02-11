$envFile = Join-Path $PSScriptRoot "..\apps\web\.env.local"
$lines = Get-Content $envFile
$keepaKey = (($lines | Where-Object { $_ -match "^KEEPA_API_KEY=(.+)$" }) -replace "^KEEPA_API_KEY=", "").Trim()

Write-Host "Testing Keepa Product Finder pages directly..." -ForegroundColor Cyan
Write-Host ""

foreach ($page in @(0, 1, 2, 3, 4, 5, 8, 9, 10)) {
    $selection = '{"brand":"LEGO","productType":0,"page":' + $page + ',"perPage":50}'
    $uri = "https://api.keepa.com/query?key=$keepaKey&domain=2&selection=$([uri]::EscapeDataString($selection))"

    try {
        $r = Invoke-RestMethod -Uri $uri -TimeoutSec 30
        $asinCount = if ($r.asinList) { $r.asinList.Count } else { 0 }
        $total = if ($r.totalResults) { $r.totalResults } else { "?" }
        Write-Host "  Page $page`: $asinCount ASINs (total=$total, tokensLeft=$($r.tokensLeft))" -ForegroundColor White
        if ($asinCount -gt 0) {
            Write-Host "    First 3: $($r.asinList[0..2] -join ', ')" -ForegroundColor Gray
        }
    } catch {
        Write-Host "  Page $page`: ERROR - $($_.Exception.Message)" -ForegroundColor Red
    }

    Start-Sleep -Seconds 2
}
