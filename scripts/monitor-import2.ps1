param(
    [string]$LogFile = "C:\Users\CHRISH~1\AppData\Local\Temp\claude\C--Users-Chris-Hadley-hadley-bricks-inventory-management\tasks\bb67f9d.output",
    [int]$IntervalMinutes = 20,
    [int]$MaxChecks = 12
)

# Find the "Skipping" line to identify where the new run starts
$allLines = Get-Content $LogFile
$skipLineIdx = -1
for ($i = $allLines.Count - 1; $i -ge 0; $i--) {
    if ($allLines[$i] -match "Skipping \d+ ASINs with existing price data, (\d+) remaining") {
        $skipLineIdx = $i
        $totalRemaining = [int]$Matches[1]
        break
    }
}

if ($skipLineIdx -eq -1) {
    Write-Host "Could not find run start marker" -ForegroundColor Red
    exit 1
}

Write-Host "New run started: $totalRemaining ASINs to import" -ForegroundColor Cyan

$checkNum = 0
while ($checkNum -lt $MaxChecks) {
    $checkNum++
    $now = Get-Date -Format "HH:mm:ss"

    $allLines = Get-Content $LogFile
    # Count imports after the skip line
    $newRunLines = $allLines | Select-Object -Skip ($skipLineIdx + 1)
    $importLines = $newRunLines | Where-Object { $_ -match "^\[KeepaImport\] B\w+ \(" }
    $imported = ($importLines | Measure-Object).Count

    $retryLines = $newRunLines | Where-Object { $_ -match "429 rate limited" }
    $retries = ($retryLines | Measure-Object).Count

    $doneLines = $newRunLines | Where-Object { $_ -match "POST /api/admin/keepa-import 200" }
    $isDone = ($doneLines | Measure-Object).Count -gt 0

    $lastImports = $importLines | Select-Object -Last 3

    # Memory check: find node.exe processes on port 3004
    $nodeProcs = Get-Process -Name "node" -ErrorAction SilentlyContinue
    $memInfo = ""
    if ($nodeProcs) {
        $biggest = $nodeProcs | Sort-Object WorkingSet64 -Descending | Select-Object -First 1
        $memMB = [math]::Round($biggest.WorkingSet64 / 1MB)
        $cpuSec = [math]::Round($biggest.CPU)
        $memInfo = "  Memory: ${memMB}MB | CPU: ${cpuSec}s (PID $($biggest.Id))"
    }

    Write-Host ""
    Write-Host "=== Check #$checkNum at $now ===" -ForegroundColor Cyan
    Write-Host "  Imported this run: $imported / $totalRemaining"
    Write-Host "  429 retries: $retries"
    if ($memInfo) {
        $memColor = if ($memMB -gt 3000) { "Red" } elseif ($memMB -gt 2000) { "Yellow" } else { "Green" }
        Write-Host $memInfo -ForegroundColor $memColor
    }
    Write-Host "  Last:" -ForegroundColor Gray
    foreach ($line in $lastImports) { Write-Host "    $line" -ForegroundColor Gray }

    if ($isDone) {
        Write-Host ""
        Write-Host "=== BATCH COMPLETE ===" -ForegroundColor Green
        $doneLine = $doneLines | Select-Object -Last 1
        Write-Host "  $doneLine"
        break
    }

    if ($memMB -gt 3500) {
        Write-Host ""
        Write-Host "  WARNING: Memory exceeds 3.5GB - server may stall soon!" -ForegroundColor Red
    }

    if ($checkNum -lt $MaxChecks) {
        Write-Host "  Next check in $IntervalMinutes minutes..." -ForegroundColor Yellow
        Start-Sleep -Seconds ($IntervalMinutes * 60)
    }
}
