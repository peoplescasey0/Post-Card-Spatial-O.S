param(
    [string]$IsoPath = "",
    [string]$QemuExe = "",
    [string]$Display = "sdl",
    [string]$Cpu = "max",
    [switch]$HostCpu,
    [switch]$Headless,
    [switch]$Detached
)

$ErrorActionPreference = "Stop"

if (-not $IsoPath) {
    $primaryIso = Join-Path $PSScriptRoot "target\postcard-spatial-os.iso"
    $demoIso = Join-Path $PSScriptRoot "target\postcard-spatial-os-live-demo.iso"
    if (Test-Path $primaryIso) {
        $IsoPath = $primaryIso
    } elseif (Test-Path $demoIso) {
        $IsoPath = $demoIso
    } else {
        $IsoPath = $primaryIso
    }
}

if (-not (Test-Path $IsoPath)) {
    throw "Post Card OS ISO not found at: $IsoPath. Run build-all.ps1 first to build the bootable ISO."
}

if (-not $QemuExe) {
    $candidates = @(
        "C:\Program Files\qemu\qemu-system-x86_64.exe",
        "C:\Program Files (x86)\qemu\qemu-system-x86_64.exe"
    )
    $cmdQemu = Get-Command qemu-system-x86_64 -ErrorAction SilentlyContinue
    if ($cmdQemu) {
        $candidates = @($cmdQemu.Source) + $candidates
    }
    foreach ($cand in $candidates) {
        if ($cand -and (Test-Path $cand)) {
            $QemuExe = $cand
            break
        }
    }
}

if (-not $QemuExe -or -not (Test-Path $QemuExe)) {
    throw "QEMU executable not found. Ensure QEMU is installed at 'C:\Program Files\qemu\qemu-system-x86_64.exe' or added to your PATH."
}

$displayArg = if ($Headless) { "none" } else { $Display }

$effectiveCpu = if ($HostCpu) { "host" } else { $Cpu }

$arguments = @(
    "-name", "Post Card Spatial OS - Live Demo",
    "-machine", "pc",
    "-cpu", $effectiveCpu,
    "-m", "256M",
    "-cdrom", $IsoPath,
    "-boot", "d",
    "-display", $displayArg,
    "-serial", "stdio",
    "-no-reboot"
)

if ($HostCpu) {
    $arguments = @("-accel", "whpx") + $arguments
}

Write-Host "===============================================================================" -ForegroundColor Cyan
Write-Host "         BOOTING POST CARD SPATIAL OS IN QEMU VIRTUAL MACHINE" -ForegroundColor Cyan
Write-Host "===============================================================================" -ForegroundColor Cyan
Write-Host "[*] QEMU Executable: $QemuExe" -ForegroundColor White
Write-Host "[*] ISO Image:       $IsoPath" -ForegroundColor White
Write-Host "[*] Display Backend: $displayArg" -ForegroundColor Yellow
Write-Host "===============================================================================" -ForegroundColor Cyan

if ($Detached) {
    Start-Process -FilePath $QemuExe -ArgumentList $arguments
    Write-Host "[+] QEMU launched in background detached mode." -ForegroundColor Green
} else {
    & $QemuExe @arguments
}
