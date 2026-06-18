# Kill all POV backfill/overnight processes (loop first so it can't respawn workers), then report.
foreach ($pass in 1..4) {
  Get-CimInstance Win32_Process |
    Where-Object { $_.CommandLine -like '*pov-overnight*' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Start-Sleep -Milliseconds 800
  Get-CimInstance Win32_Process |
    Where-Object { $_.CommandLine -like '*pov-backfill*' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Start-Sleep -Seconds 2
  $n = @(Get-CimInstance Win32_Process |
    Where-Object { $_.CommandLine -like '*pov-backfill*' -or $_.CommandLine -like '*pov-overnight*' }).Count
  Write-Output "pass ${pass}: remaining=$n"
  if ($n -eq 0) { break }
}
