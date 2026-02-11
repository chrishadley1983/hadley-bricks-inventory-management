param(
    [string]$LogFile = "C:\Users\CHRISH~1\AppData\Local\Temp\claude\C--Users-Chris-Hadley-hadley-bricks-inventory-management\tasks\b27fa8e.output",
    [int]$IntervalMinutes = 20,
    [int]$MaxChecks = 12
)

$checkNum = 0
while ($checkNum -lt $MaxChecks) {
    $checkNum++
    $now = Get-Date -Format "HH:mm:ss"

    # Count successful imports from second run (after line 27618 where recompile happened)
    $allLines = Get-Content $LogFile
    $importLines = $allLines | Where-Object { $_ -match "^\[KeepaImport\] B\w+ \(" }
    $totalImported = ($importLines | Measure-Object).Count

    # Count 429 retries
    $retryLines = $allLines | Where-Object { $_ -match "429 rate limited" }
    $totalRetries = ($retryLines | Measure-Object).Count

    # Check if the POST response has been sent (meaning it's done)
    $doneLines = $allLines | Where-Object { $_ -match "POST /api/admin/keepa-import 200" }
    $doneCount = ($doneLines | Measure-Object).Count

    # Get last few import lines for context
    $lastImports = $importLines | Select-Object -Last 3

    Write-Host ""
    Write-Host "=== Progress Check #$checkNum at $now ===" -ForegroundColor Cyan
    Write-Host "  ASINs imported (total across runs): $totalImported / 6816"
    Write-Host "  429 retries: $totalRetries"
    Write-Host "  Completed responses: $doneCount (need 2 = both runs done)"
    Write-Host "  Last imports:" -ForegroundColor Gray
    foreach ($line in $lastImports) {
        Write-Host "    $line" -ForegroundColor Gray
    }

    if ($doneCount -ge 2) {
        Write-Host ""
        Write-Host "=== IMPORT COMPLETE ===" -ForegroundColor Green
        # Show the final response line
        $responseLine = $allLines | Where-Object { $_ -match "POST /api/admin/keepa-import" } | Select-Object -Last 1
        Write-Host "  $responseLine"
        break
    }

    if ($checkNum -lt $MaxChecks) {
        Write-Host "  Next check in $IntervalMinutes minutes..." -ForegroundColor Yellow
        Start-Sleep -Seconds ($IntervalMinutes * 60)
    }
}
