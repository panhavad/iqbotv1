<#
.SYNOPSIS
  Opens the dedicated test Chrome for the Next Minute Auto Trader, already logged in to IQ Option,
  with the extension of this repository loaded.

.DESCRIPTION
  The test browser uses its own profile outside the project (%LOCALAPPDATA%\iqbot\chrome-profile),
  so it never touches your everyday Chrome. Log in to IQ Option there once: the login (ssid cookie,
  about 30 days) stays in that profile between runs. A DevTools port on 127.0.0.1 lets test scripts
  drive the page (Playwright connectOverCDP or raw CDP).

  The extension is loaded from this repository's extension folder at every start (test-browser.js;
  needs Node.js). Its fixed ID keeps its settings and learned logic between runs, wherever the
  repository is.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File extension\tools\start-test-browser.ps1
#>
param(
    [int]$Port = 9555,
    [string]$Url = 'https://iqoption.com/traderoom',
    [string]$ProfileDir = (Join-Path $env:LOCALAPPDATA 'iqbot\chrome-profile'),
    [switch]$Headless
)

try {
    $version = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/json/version" -TimeoutSec 2
    Write-Output "Test browser already running on port $Port ($($version.Browser))."
    return
} catch {
    # Not running yet.
}

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { throw 'Node.js was not found: it is needed to load the extension into the test browser.' }

$launcher = Join-Path $PSScriptRoot 'test-browser.js'
$logDir = Split-Path -Parent $ProfileDir
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$log = Join-Path $logDir 'test-browser.log'
$errLog = Join-Path $logDir 'test-browser.err.log'
$arguments = @("`"$launcher`"", '--port', $Port, '--profile', "`"$ProfileDir`"", '--url', "`"$Url`"")
if ($Headless) { $arguments += '--headless' }
# The launcher keeps running in the background while Chrome is open (it holds the DevTools pipe).
Start-Process -FilePath $node.Source -ArgumentList $arguments -WindowStyle Hidden `
    -RedirectStandardOutput $log -RedirectStandardError $errLog | Out-Null

$deadline = (Get-Date).AddSeconds(30)
while ((Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 500
    $text = Get-Content $log -Raw -ErrorAction SilentlyContinue
    if ($text -match 'Could not start') { throw ($text.Trim() + ' (log: ' + $log + ')') }
    if ($text -match 'Opened ') {
        Write-Output $text.Trim()
        return
    }
}
throw "The test browser did not start within 30 seconds (log: $log)."
