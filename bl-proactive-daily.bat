@echo off
REM ============================================================================
REM  Hadley Bricks — proactive BL store evaluation, runs daily via Task Scheduler
REM
REM  Now runs in full-enrich mode with a 4K session-level API budget cap so the
REM  daily run uses up most of the BL 5K/day allowance and grows the cache fast.
REM  Loops up to 50 stores per session; stops early on session-budget cap, queue
REM  empty, or first error.
REM
REM  Pre-condition: CDP Chrome must be running on :9222 and logged in to BL.
REM                 If it's not, the daily runner aborts cleanly + emails the reason.
REM
REM  Logs to:  tmp\proactive-daily-<YYYY-MM-DD>.log
REM
REM  Manual test:  bl-proactive-daily.bat
REM  Dry-run:      bl-proactive-daily.bat --dry-run
REM  Override budget: bl-proactive-daily.bat --session-api-budget=2000
REM ============================================================================

setlocal

cd /d "%~dp0\apps\web"

REM Get today's date in YYYY-MM-DD (locale-agnostic via WMIC).
for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyy-MM-dd"') do set TODAY=%%i

set LOGFILE=..\..\tmp\proactive-daily-%TODAY%.log
if not exist "..\..\tmp" mkdir "..\..\tmp"

echo. >> "%LOGFILE%"
echo ==== %DATE% %TIME% ==== >> "%LOGFILE%"

REM Default flags can be overridden by anything passed in (later wins via CLI).
call npx tsx scripts/bl-proactive-batch.ts --count=50 --full-enrich --session-api-budget=4000 --min-delay-sec=120 --max-delay-sec=300 %* 1>> "%LOGFILE%" 2>&1

set EXITCODE=%ERRORLEVEL%
echo Exit: %EXITCODE% >> "%LOGFILE%"

endlocal & exit /b %EXITCODE%
