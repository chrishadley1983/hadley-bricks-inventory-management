@echo off
REM Hadley Bricks business dashboard — weekly rebuild + surge redeploy.
REM Registered as Windows scheduled task "HadleyBricksDashboard" (weekly, Mon 07:00).
REM Pulls latest GA4 / Search Console / sales / feed / inventory, asks the local Claude
REM session for the 1-page summary (falls back to a deterministic one if the channel is
REM down), AES-encrypts, and republishes to surge. Logs to %LOCALAPPDATA%.
cd /d "C:\Users\Chris Hadley\claude-projects\hadley-bricks-inventory-management\apps\web"
echo ===== %DATE% %TIME% rebuild ===== >> "%LOCALAPPDATA%\hb-dashboard-refresh.log"
call npx tsx --env-file=.env.local scripts/dashboard/build-dashboard.ts >> "%LOCALAPPDATA%\hb-dashboard-refresh.log" 2>&1
