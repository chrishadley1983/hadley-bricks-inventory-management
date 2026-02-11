Start-Sleep -Seconds 15
$attempts = 0
while ($attempts -lt 10) {
    try {
        Invoke-WebRequest -Uri 'http://localhost:3000' -TimeoutSec 3 -ErrorAction Stop | Out-Null
        Write-Host 'Dev server ready'
        exit 0
    } catch {
        $attempts = $attempts + 1
        Start-Sleep -Seconds 3
    }
}
Write-Host 'Timeout waiting for dev server'
exit 1
