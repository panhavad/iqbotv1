<#
.SYNOPSIS
  Opens the dedicated test Chrome for the Next Minute Auto Trader, already logged in to IQ Option.

.DESCRIPTION
  The test browser uses its own profile outside the project (%LOCALAPPDATA%\iqbot\chrome-profile),
  so it never touches your everyday Chrome. Log in to IQ Option there once: the login (ssid cookie,
  about 30 days) and the unpacked extension stay in that profile between runs. A DevTools port on
  127.0.0.1 lets test scripts drive the page (Playwright connectOverCDP or raw CDP).

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File extension\tools\start-test-browser.ps1
#>
param(
    [int]$Port = 9555,
    [string]$Url = 'https://iqoption.com/traderoom',
    [string]$ProfileDir = (Join-Path $env:LOCALAPPDATA 'iqbot\chrome-profile')
)

$candidates = @(
    (Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'),
    (Join-Path ${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe'),
    (Join-Path $env:LOCALAPPDATA 'Google\Chrome\Application\chrome.exe')
)
$chrome = $candidates | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
if (-not $chrome) { throw 'Google Chrome was not found.' }

try {
    $version = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/json/version" -TimeoutSec 2
    Write-Output "Test browser already running on port $Port ($($version.Browser))."
    return
} catch {
    # Not running yet.
}

New-Item -ItemType Directory -Force -Path $ProfileDir | Out-Null
$arguments = @(
    "--user-data-dir=`"$ProfileDir`"",
    "--remote-debugging-port=$Port",
    '--remote-debugging-address=127.0.0.1',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-sync',
    # Keep the chart and the trader running at full speed when the window is not in front.
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-background-timer-throttling',
    $Url
)
Start-Process -FilePath $chrome -ArgumentList $arguments | Out-Null

$deadline = (Get-Date).AddSeconds(20)
while ((Get-Date) -lt $deadline) {
    try {
        $version = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/json/version" -TimeoutSec 2
        Write-Output "Test browser started on port $Port ($($version.Browser)). Profile: $ProfileDir"
        return
    } catch {
        Start-Sleep -Milliseconds 500
    }
}
throw "Chrome started but the DevTools port $Port did not answer."
