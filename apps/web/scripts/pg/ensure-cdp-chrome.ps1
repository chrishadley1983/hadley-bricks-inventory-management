# ensure-cdp-chrome.ps1 - make the dedicated CDP Chrome reachable, launching it if needed.
#
# Every PG lane-D run drives the domham91 CDP Chrome (port 9225, GBP display). Until
# 2026-08-09 the wrappers only PRE-CHECKED that browser and exited cleanly when it was
# down, which meant a browser crash silently cost every subsequent run until a human
# noticed. It did: Chrome degraded into "CDP call timed out: Runtime.evaluate" at 19:00 on
# 08-08, was gone by 21:00, and the 00:05 nightly skipped with a 604-byte log. ~2,700
# tuples and a whole nightly window were lost, and the only signal was Chris spotting it
# the next morning. This script closes that gap: heal first, alert if healing fails.
#
# WHY Win32_Process::Create AND NOT Start-Process - this is the load-bearing detail.
# A process started as a CHILD of this script shares its process tree, and Task Scheduler
# terminates a task's whole tree when the task ends or hits its ExecutionTimeLimit. A
# Chrome launched with Start-Process would therefore be killed by the very run that
# launched it - turning the healer into a second cause of the outage it exists to fix.
# Win32_Process::Create parents the new process to the WMI provider host instead, so
# Chrome outlives this script, the run, and the scheduled task. Verified 2026-08-09:
# Start-Process Chrome did not survive across shell invocations; the WMI-spawned instance
# did (parent PID = WmiPrvSE, confirmed still listening after the launching shell exited).
#
# Exit codes: 0 = CDP reachable (was already up, or we brought it up). 1 = still down.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts\pg\ensure-cdp-chrome.ps1 [-Port 9225]
param(
    [int]$Port = 9225,
    [int]$WaitSeconds = 60,
    [string]$ChromePath = 'C:\Program Files\Google\Chrome\Application\chrome.exe',
    [string]$UserDataDir = 'C:\chrome-cdp'
)

function Test-CdpReachable {
    param([int]$Port)
    try {
        $resp = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/json/version" -TimeoutSec 3 -UseBasicParsing
        return $resp.StatusCode -eq 200
    } catch {
        return $false
    }
}

if (Test-CdpReachable -Port $Port) {
    Write-Output "[ensure-cdp-chrome] CDP already reachable on port $Port"
    exit 0
}

if (-not (Test-Path $ChromePath)) {
    Write-Output "[ensure-cdp-chrome] FAILED: chrome.exe not found at $ChromePath"
    exit 1
}

Write-Output "[ensure-cdp-chrome] CDP down on port $Port - launching Chrome (profile $UserDataDir)"

# --user-data-dir must be non-default (Chrome 136+ refuses remote debugging on the default
# profile). Port split 2026-07-14: 9225 = this Chrome, 9222 = Chrome-Vinted. Never merge
# them - whichever launched second used to silently lose the port and jobs attached to the
# wrong browser.
$cmd = "`"$ChromePath`" --remote-debugging-port=$Port --remote-allow-origins=* " +
       "--user-data-dir=$UserDataDir --no-first-run --no-default-browser-check"

try {
    $result = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = $cmd }
    if ($result.ReturnValue -ne 0) {
        Write-Output "[ensure-cdp-chrome] FAILED: Win32_Process::Create returned $($result.ReturnValue)"
        exit 1
    }
    Write-Output "[ensure-cdp-chrome] spawned detached chrome.exe pid=$($result.ProcessId)"
} catch {
    Write-Output "[ensure-cdp-chrome] FAILED to spawn Chrome: $($_.Exception.Message)"
    exit 1
}

$deadline = (Get-Date).AddSeconds($WaitSeconds)
while ((Get-Date) -lt $deadline) {
    Start-Sleep -Seconds 3
    if (Test-CdpReachable -Port $Port) {
        Write-Output "[ensure-cdp-chrome] CDP up on port $Port"
        exit 0
    }
}

# Chrome started but never opened the port: a profile lock from a half-dead instance, a
# crashed-profile restore prompt, or a Chrome update in progress. A human needs to look -
# the caller alerts on this exit code.
Write-Output "[ensure-cdp-chrome] FAILED: Chrome spawned but CDP not reachable after ${WaitSeconds}s"
exit 1
