param(
    [int]$MaxBatches = 5,
    [int]$Port = 3004,
    [int]$MemoryLimitMB = 3500
)

$envFile = Join-Path $PSScriptRoot "..\apps\web\.env.local"
$lines = Get-Content $envFile
$serviceKey = (($lines | Where-Object { $_ -match "^SUPABASE_SERVICE_ROLE_KEY=" }) -replace "^SUPABASE_SERVICE_ROLE_KEY=", "").Trim()
$supabaseUrl = (($lines | Where-Object { $_ -match "^NEXT_PUBLIC_SUPABASE_URL=" }) -replace "^NEXT_PUBLIC_SUPABASE_URL=", "").Trim()
$supabaseKey = $serviceKey

$headers = @{
    "Authorization" = "Bearer $serviceKey"
    "Content-Type"  = "application/json"
}

$dbHeaders = @{ "apikey" = $supabaseKey; "Authorization" = "Bearer $supabaseKey" }

function Get-ImportedCount {
    # Count distinct sets with keepa price data
    $offset = 0
    $pageSize = 1000
    $sets = @{}
    $hasMore = $true
    while ($hasMore) {
        $data = Invoke-RestMethod -Uri "$supabaseUrl/rest/v1/price_snapshots?source=eq.keepa_amazon_buybox&select=set_num&order=set_num&offset=$offset&limit=$pageSize" -Headers $dbHeaders
        if ($data.Count -eq 0) { $hasMore = $false; break }
        foreach ($row in $data) { $sets[$row.set_num] = $true }
        $hasMore = $data.Count -eq $pageSize
        $offset += $pageSize
    }
    return $sets.Count
}

function Get-NodeMemoryMB {
    $procs = Get-Process -Name "node" -ErrorAction SilentlyContinue
    if ($procs) {
        $biggest = $procs | Sort-Object WorkingSet64 -Descending | Select-Object -First 1
        return [math]::Round($biggest.WorkingSet64 / 1MB)
    }
    return 0
}

function Restart-DevServer {
    Write-Host "  Restarting dev server..." -ForegroundColor Yellow
    Get-Process -Name "node" -ErrorAction SilentlyContinue | Where-Object { $_.WorkingSet64 -gt 500MB } | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 5

    # Start dev server in background
    $serverJob = Start-Job -ScriptBlock {
        Set-Location $using:PSScriptRoot
        Set-Location ".."
        Set-Location "apps\web"
        & npx next dev -p $using:Port 2>&1
    }

    # Wait for server to be ready
    $ready = $false
    for ($i = 0; $i -lt 30; $i++) {
        Start-Sleep -Seconds 2
        try {
            $null = Invoke-WebRequest -Uri "http://localhost:$Port/api/health" -TimeoutSec 3 -ErrorAction Stop
            $ready = $true
            break
        } catch {
            if ($_.Exception.Response.StatusCode.value__ -eq 404) {
                $ready = $true
                break
            }
        }
    }

    if (-not $ready) {
        Write-Host "  Server failed to start!" -ForegroundColor Red
        return $false
    }

    Write-Host "  Server ready." -ForegroundColor Green
    return $true
}

Write-Host "=== Auto-Batch Keepa Import ===" -ForegroundColor Cyan
Write-Host "Max batches: $MaxBatches"
Write-Host ""

for ($batch = 1; $batch -le $MaxBatches; $batch++) {
    $batchStart = Get-Date
    $beforeCount = Get-ImportedCount
    $memMB = Get-NodeMemoryMB

    Write-Host "--- Batch $batch starting at $(Get-Date -Format 'HH:mm:ss') ---" -ForegroundColor Cyan
    Write-Host "  Sets already imported: $beforeCount"
    Write-Host "  Server memory: ${memMB}MB"

    # Check if server needs restart (high memory or unresponsive)
    $needsRestart = $false
    if ($memMB -gt $MemoryLimitMB) {
        Write-Host "  Memory too high (${memMB}MB > ${MemoryLimitMB}MB), will restart" -ForegroundColor Yellow
        $needsRestart = $true
    }

    if ($batch -gt 1 -or $needsRestart) {
        # Check if server responds
        try {
            $null = Invoke-WebRequest -Uri "http://localhost:$Port/" -TimeoutSec 5 -ErrorAction Stop
        } catch {
            if (-not $_.Exception.Response) {
                Write-Host "  Server unresponsive, will restart" -ForegroundColor Yellow
                $needsRestart = $true
            }
        }
    }

    if ($needsRestart) {
        $ok = Restart-DevServer
        if (-not $ok) {
            Write-Host "FATAL: Could not restart server. Stopping." -ForegroundColor Red
            break
        }
        Start-Sleep -Seconds 5
    }

    # Fire the import request
    Write-Host "  Sending import request..." -ForegroundColor Gray
    $body = '{"retiredSets":true}'

    try {
        $r = Invoke-RestMethod -Uri "http://localhost:${Port}/api/admin/keepa-import" -Method Post -Headers $headers -Body $body -TimeoutSec 3600
        Write-Host "  Response: $($r.message)" -ForegroundColor Green
        Write-Host "  ASINs: $($r.stats.total_asins), Snapshots: $($r.stats.total_snapshots_imported), Duration: $([math]::Round($r.stats.duration_ms / 1000))s"
    } catch {
        Write-Host "  Request ended (timeout or error): $($_.Exception.Message)" -ForegroundColor Yellow
    }

    $afterCount = Get-ImportedCount
    $elapsed = [math]::Round(((Get-Date) - $batchStart).TotalMinutes, 1)

    Write-Host ""
    Write-Host "  Batch $batch complete:" -ForegroundColor Green
    Write-Host "    Before: $beforeCount sets"
    Write-Host "    After:  $afterCount sets"
    Write-Host "    New:    $($afterCount - $beforeCount) sets"
    Write-Host "    Time:   ${elapsed} min"
    Write-Host ""

    # Check if we're done (no new sets imported)
    if ($afterCount -eq $beforeCount) {
        Write-Host "=== NO NEW SETS IMPORTED - Import complete or stalled ===" -ForegroundColor Yellow
        break
    }

    # Brief pause between batches
    if ($batch -lt $MaxBatches) {
        Write-Host "  Pausing 10s before next batch..." -ForegroundColor Gray
        Start-Sleep -Seconds 10
    }
}

$finalCount = Get-ImportedCount
Write-Host ""
Write-Host "=== ALL BATCHES COMPLETE ===" -ForegroundColor Green
Write-Host "Total sets with price data: $finalCount"
Write-Host "Target: 6,816 retired sets"
Write-Host "Coverage: $([math]::Round($finalCount / 6816 * 100, 1))%"
