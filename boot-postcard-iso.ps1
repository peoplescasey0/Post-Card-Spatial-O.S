param(
    [string]$IsoPath = (Join-Path $PSScriptRoot "target\postcard-spatial-os-live-demo.iso"),
    [string]$QemuExe = "C:\Program Files\qemu\qemu-system-x86_64.exe",
    [string]$Display = "sdl",
    [switch]$Headless
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path $IsoPath)) {
    throw "Post Card OS ISO not found at: $IsoPath"
}
if (-not (Test-Path $QemuExe)) {
    throw "QEMU executable not found at: $QemuExe"
}

$displayArg = if ($Headless) { "none" } else { $Display }

$arguments = @(
    "-name", "Post Card Spatial OS - Live Demo",
    "-machine", "pc",
    "-m", "256M",
    "-cdrom", $IsoPath,
    "-boot", "d",
    "-display", $displayArg,
    "-serial", "stdio",
    "-no-reboot"
)

Write-Host "Booting Post Card Spatial OS from: $IsoPath" -ForegroundColor Cyan
Write-Host "Display: $displayArg" -ForegroundColor Yellow

& $QemuExe @arguments
