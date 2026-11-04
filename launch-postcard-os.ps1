<#
.SYNOPSIS
    Post Card Spatial OS - Studio Desktop Launcher
.DESCRIPTION
    Launches the Post Card 3D Spatial Hypervisor Studio, starting the local
    Vite + Guest API server if not already running, and opening the browser.
#>

[CmdletBinding()]
param(
    [int]$Port = 5173,
    [string]$HostName = "localhost",
    [switch]$NoBrowser
)

$ErrorActionPreference = "Stop"

Write-Host "===============================================================================" -ForegroundColor Cyan
Write-Host "               POST CARD SPATIAL OS - 3D HYPERVISOR STUDIO" -ForegroundColor Cyan
Write-Host "===============================================================================" -ForegroundColor Cyan
Write-Host ""

# 1. Check Node.js runtime
try {
    $nodeVersion = & node -v
    Write-Host "[*] Node.js runtime detected: $nodeVersion" -ForegroundColor Green
} catch {
    Write-Error "Node.js was not found in PATH. Please install Node.js (v18+) from https://nodejs.org/"
    return
}

# 2. Locate workspace directory
$rootPath = $PSScriptRoot
if (-not $rootPath) {
    $rootPath = Get-Location
}
$workspacePath = Join-Path $rootPath "workspace-prototype"

if (-not (Test-Path (Join-Path $workspacePath "package.json"))) {
    Write-Error "Could not locate workspace-prototype/package.json at '$workspacePath'."
    return
}

# 3. Check node_modules
$nodeModulesPath = Join-Path $workspacePath "node_modules"
if (-not (Test-Path $nodeModulesPath)) {
    Write-Host "[*] First-run setup: Installing workspace dependencies..." -ForegroundColor Yellow
    Push-Location $workspacePath
    try {
        & npm install
    } finally {
        Pop-Location
    }
}

# 4. Check if Studio is already active on the designated port
$isListening = $false
try {
    $tcp = New-Object System.Net.Sockets.TcpClient
    $iar = $tcp.BeginConnect("127.0.0.1", $Port, $null, $null)
    $success = $iar.AsyncWaitHandle.WaitOne(800, $false)
    if ($success -and $tcp.Connected) {
        $isListening = $true
        $tcp.EndConnect($iar)
    }
    $tcp.Close()
} catch {
    $isListening = $false
}

$studioUrl = "http://${HostName}:${Port}/"

if ($isListening) {
    Write-Host "[OK] Studio server is already running on $studioUrl" -ForegroundColor Green
} else {
    Write-Host "[*] Starting Post Card Studio dev server in background..." -ForegroundColor Yellow
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = "cmd.exe"
    $psi.Arguments = "/c npm run dev"
    $psi.WorkingDirectory = $workspacePath
    $psi.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Minimized
    $psi.UseShellExecute = $true
    [System.Diagnostics.Process]::Start($psi) | Out-Null

    Write-Host "[*] Waiting for Studio server to bind to port $Port..." -ForegroundColor Cyan
    $bound = $false
    for ($i = 0; $i -lt 20; $i++) {
        Start-Sleep -Milliseconds 800
        try {
            $testTcp = New-Object System.Net.Sockets.TcpClient
            $testIar = $testTcp.BeginConnect("127.0.0.1", $Port, $null, $null)
            $connOk = $testIar.AsyncWaitHandle.WaitOne(500, $false)
            if ($connOk -and $testTcp.Connected) {
                $bound = $true
                $testTcp.EndConnect($testIar)
                $testTcp.Close()
                break
            }
            $testTcp.Close()
        } catch {
            # continue loop
        }
    }

    if ($bound) {
        Write-Host "[OK] Studio server ready on $studioUrl" -ForegroundColor Green
    } else {
        Write-Host "[WARN] Server starting slowly. Attempting to open browser regardless..." -ForegroundColor Yellow
    }
}

# 5. Open browser unless requested otherwise
if (-not $NoBrowser) {
    Write-Host "[*] Opening $studioUrl in your default browser..." -ForegroundColor Cyan
    Start-Process $studioUrl
}

Write-Host ""
Write-Host "===============================================================================" -ForegroundColor Green
Write-Host " [READY] Studio running at: $studioUrl" -ForegroundColor Green
Write-Host "  - Keys WASD or 1-6 : 6-way card facet flips" -ForegroundColor DarkGray
Write-Host "  - Key [T]          : In-place 3D face-off twist" -ForegroundColor DarkGray
Write-Host "  - Key [?]          : Interactive Operator Field Guide & Notes" -ForegroundColor DarkGray
Write-Host "  - Key [Space]      : Quick card zoom lock" -ForegroundColor DarkGray
Write-Host "===============================================================================" -ForegroundColor Green
