<#
.SYNOPSIS
  Hourly cron wrapper for the BrickLink CDP message scraper.

.DESCRIPTION
  Runs `npx tsx scripts/sync-bl-messages.ts` against local CDP Chrome.
  Skips silently if outside 08:00-22:00 local time or if CDP Chrome is
  unreachable on :9225. Appends output to %USERPROFILE%\.hadley-bricks-logs\bl-cdp.log.

  Register via Task Scheduler:
    schtasks /Create /SC HOURLY /MO 1 /TN "HadleyBricks-OrderIssues-BL-CDP" `
      /TR "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"<repo>\apps\web\scripts\sync-bl-messages-cron.ps1`"" `
      /ST 08:00 /F
#>

$ErrorActionPreference = 'Continue'
$ProjectRoot = "C:\Users\Chris Hadley\claude-projects\hadley-bricks-inventory-management\apps\web"
$LogDir = Join-Path $env:USERPROFILE ".hadley-bricks-logs"
if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir | Out-Null }
$LogFile = Join-Path $LogDir "bl-cdp.log"

function Log($msg) {
  $line = "[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg
  Add-Content -Path $LogFile -Value $line
}

Log "----- run starting -----"

$hour = (Get-Date).Hour
if ($hour -lt 8 -or $hour -ge 22) {
  Log "outside working window (hour=$hour); skipping"
  exit 0
}

# Probe CDP Chrome
try {
  $resp = Invoke-WebRequest -Uri 'http://127.0.0.1:9225/json/version' -TimeoutSec 3 -UseBasicParsing -ErrorAction Stop
  if ($resp.StatusCode -ne 200) { throw "CDP returned $($resp.StatusCode)" }
} catch {
  Log "CDP Chrome not reachable on :9225 ($($_.Exception.Message)); skipping"
  exit 0
}

Set-Location $ProjectRoot
Log "running: npx tsx scripts/sync-bl-messages.ts --discover"
& cmd.exe /c "npx tsx scripts/sync-bl-messages.ts --discover >> `"$LogFile`" 2>&1"
$exit = $LASTEXITCODE
Log "exit=$exit"
exit $exit
