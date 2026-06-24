<#
.SYNOPSIS
  Rebuild and restart the local HadleyBricks production server so it serves the
  currently-deployed code. Run this as the FINAL step of every deploy/merge.

.DESCRIPTION
  The HadleyBricks Windows service (NSSM) runs "next start" against a prebuilt
  apps/web/.next bundle on http://localhost:3000. "next start" does NOT hot-reload
  source changes - it only updates when the bundle is rebuilt and the service is
  restarted.

  That local server (NOT Vercel) is what the Peter bot / WhatsApp flows and all the
  morning HB crons actually hit (jobs/hb_crons.py uses HB_BASE=localhost:3000:
  ebay-stock-sync, full-sync, bricqer-batch-sync, picking-list snapshot, ...). So a
  Vercel deploy alone never reaches them: the local server can silently run code
  that is many PRs stale. (Root case 2026-06-23: a Pending Amazon order kept
  appearing in the WhatsApp pick list because the local build predated the fix.)

  This script:
    1. Builds apps/web (production bundle).
    2. ONLY if the build succeeds, restarts the HadleyBricks service via the Peter
       Dashboard API (POST /api/restart/hadley_bricks) - which manages the NSSM
       service WITHOUT needing an elevated shell.
    3. Waits for :3000 to serve again and reports.

  A failed build leaves the previous (working) server running untouched.

.PARAMETER SkipBuild
  Restart only, do not rebuild (e.g. to recover a crashed server on the current build).

.PARAMETER DashboardUrl
  Peter Dashboard base URL. Default http://localhost:5000 (or $env:DASHBOARD_URL).

.PARAMETER AuthKey
  Dashboard x-api-key. Default $env:HADLEY_AUTH_KEY, else read from the sibling
  Discord-Messenger/.env (HADLEY_AUTH_KEY=...).

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts/redeploy-local.ps1
#>
[CmdletBinding()]
param(
  [switch] $SkipBuild,
  [string] $DashboardUrl = $(if ($env:DASHBOARD_URL) { $env:DASHBOARD_URL } else { 'http://localhost:5000' }),
  [string] $AuthKey = $env:HADLEY_AUTH_KEY
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot   # scripts/ -> repo root

function Write-Step($msg) { Write-Host "==> $msg" -ForegroundColor Cyan }
function Fail($msg) { Write-Host "FAILED: $msg" -ForegroundColor Red; exit 1 }

# --- 1. Build ----------------------------------------------------------------
if (-not $SkipBuild) {
  Write-Step 'Building apps/web (next build)...'
  Push-Location (Join-Path $repoRoot 'apps/web')
  try {
    $env:NODE_OPTIONS = '--max-old-space-size=4096'
    npm run build
    if ($LASTEXITCODE -ne 0) {
      Pop-Location
      Fail "next build exited $LASTEXITCODE - leaving the running server on its previous (working) build. Fix the build, then re-run."
    }
  } finally {
    if ((Get-Location).Path -ne $repoRoot) { Pop-Location }
  }
  Write-Step 'Build OK.'
} else {
  Write-Step 'SkipBuild set - restarting current build only.'
}

# --- 2. Resolve dashboard auth key ------------------------------------------
if (-not $AuthKey) {
  $envFile = Join-Path (Split-Path -Parent $repoRoot) 'Discord-Messenger/.env'
  if (Test-Path $envFile) {
    $line = Select-String -Path $envFile -Pattern '^HADLEY_AUTH_KEY=' -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($line) { $AuthKey = ($line.Line -replace '^HADLEY_AUTH_KEY=', '').Trim().Trim('"').Trim("'") }
  }
}
if (-not $AuthKey) {
  Fail 'No dashboard auth key. Set $env:HADLEY_AUTH_KEY or add HADLEY_AUTH_KEY=... to Discord-Messenger/.env.'
}

# --- 3. Restart via dashboard (no elevation needed) --------------------------
Write-Step "Restarting HadleyBricks via dashboard ($DashboardUrl)..."
try {
  $resp = Invoke-RestMethod -Method Post -Uri "$DashboardUrl/api/restart/hadley_bricks" `
    -Headers @{ 'x-api-key' = $AuthKey } -TimeoutSec 90
} catch {
  Fail "Dashboard restart call failed: $($_.Exception.Message). Is the PeterDashboard service up on $DashboardUrl? You can also restart HadleyBricks from the dashboard UI."
}
if (-not $resp.details.success) {
  Fail "Dashboard reported restart failure: $($resp | ConvertTo-Json -Depth 6 -Compress)"
}
$newPid = $resp.details.start_result.pid
Write-Step "Service restarted (pid $newPid on :3000)."

# --- 4. Wait for :3000 to serve ---------------------------------------------
Write-Step 'Waiting for localhost:3000 to respond...'
$deadline = (Get-Date).AddSeconds(90)
$up = $false
while ((Get-Date) -lt $deadline) {
  try {
    $h = Invoke-WebRequest -Uri 'http://localhost:3000/api/health' -TimeoutSec 5 -UseBasicParsing
    if ($h.StatusCode -eq 200) { $up = $true; break }
  } catch { Start-Sleep -Seconds 3 }
}
if ($up) {
  Write-Host 'OK: local production server is rebuilt and live on http://localhost:3000' -ForegroundColor Green
} else {
  Write-Host 'WARNING: restart issued but :3000 did not return 200 within 90s. Check the dashboard / service logs.' -ForegroundColor Yellow
  exit 2
}
