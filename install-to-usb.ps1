<#
.SYNOPSIS
    Post Card Spatial OS - 1-Click Bootable USB Installer
.DESCRIPTION
    Flashes the Post Card Spatial OS live bootable environment onto a USB flash drive.
    Prepares GPT partition table, EFI System Partition (FAT32), GRUB UEFI bootloader,
    and the compiled release micro-kernel.

    Must be run in an elevated PowerShell session (Run as Administrator).
.EXAMPLE
    .\install-to-usb.ps1
.EXAMPLE
    .\install-to-usb.ps1 -DiskNumber 2 -Force
#>

[CmdletBinding()]
param(
    [Parameter(Position=0)]
    [int]$DiskNumber = -1,
    [switch]$Force
)

$ErrorActionPreference = "Stop"

# Verify Administrator Privileges
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Warning "This script requires Administrator privileges to format and partition physical USB drives."
    Write-Host "Please right-click PowerShell and select 'Run as administrator', then rerun:" -ForegroundColor Yellow
    Write-Host "  powershell -ExecutionPolicy Bypass -File .\install-to-usb.ps1" -ForegroundColor Cyan
    return
}

$root = $PSScriptRoot
if (-not $root) { $root = Get-Location }

Write-Host "===============================================================================" -ForegroundColor Cyan
Write-Host "         POST CARD SPATIAL OS - 1-CLICK BOOTABLE USB INSTALLER" -ForegroundColor Cyan
Write-Host "===============================================================================" -ForegroundColor Cyan
Write-Host ""

# 1. Verify Deployment Bundle
$bundleDir = Join-Path $root "target\usb-deploy-bundle"
$kernelElf = Join-Path $bundleDir "postcard-kernel"
$bootEfi = Join-Path $bundleDir "EFI\BOOT\BOOTX64.EFI"

if (-not (Test-Path $kernelElf) -or -not (Test-Path $bootEfi)) {
    Write-Host "[*] Deployment bundle missing or incomplete. Building unified pipeline first..." -ForegroundColor Yellow
    & powershell -ExecutionPolicy Bypass -File (Join-Path $root "build-all.ps1")
}

# 2. Discover USB Disks
$usbDisks = Get-Disk | Where-Object { $_.BusType -eq 'USB' }

if (-not $usbDisks) {
    Write-Host "[!] No USB flash drives detected!" -ForegroundColor Red
    Write-Host "    All currently detected physical drives on this machine:" -ForegroundColor Yellow
    Get-Disk | Format-Table Number, FriendlyName, OperationalStatus, TotalSize, PartitionStyle, BusType -AutoSize
    Write-Host "Please insert a USB flash drive and run this script again." -ForegroundColor Yellow
    return
}

Write-Host "Detected USB Flash Drive(s):" -ForegroundColor Green
$usbDisks | Format-Table Number, FriendlyName, OperationalStatus, @{Label="Size (GB)"; Expression={[math]::Round($_.TotalSize / 1GB, 2)}}, PartitionStyle -AutoSize

if ($DiskNumber -lt 0) {
    if ($usbDisks.Count -eq 1) {
        $selectedDisk = $usbDisks[0]
        $DiskNumber = $selectedDisk.Number
        Write-Host "Auto-selected single USB drive: Disk $DiskNumber ($($selectedDisk.FriendlyName))" -ForegroundColor Cyan
    } else {
        $prompt = Read-Host "Enter the Disk Number of the USB drive you wish to format"
        if (-not [int]::TryParse($prompt, [ref]$DiskNumber)) {
            Write-Error "Invalid disk number entered."
            return
        }
    }
}

$targetDisk = Get-Disk -Number $DiskNumber -ErrorAction SilentlyContinue
if (-not $targetDisk) {
    Write-Error "Disk $DiskNumber does not exist."
    return
}

if ($targetDisk.BusType -ne 'USB' -and -not $Force) {
    Write-Error "Disk $DiskNumber is reported as '$($targetDisk.BusType)' (NOT a USB drive). Refusing to proceed without -Force flag to prevent accidental data loss on internal system drives!"
    return
}

Write-Host ""
Write-Host "===============================================================================" -ForegroundColor Red
Write-Host ("  WARNING: ALL DATA ON DISK {0} ({1}) WILL BE PERMANENTLY ERASED!" -f $DiskNumber, $targetDisk.FriendlyName) -ForegroundColor Red
Write-Host "===============================================================================" -ForegroundColor Red
Write-Host ""

if (-not $Force) {
    $confirm = Read-Host "Type 'YES' to proceed with wiping and installing Post Card Spatial OS"
    if ($confirm -ne 'YES') {
        Write-Host "Installation aborted by user." -ForegroundColor Yellow
        return
    }
}

Write-Host ""
Write-Host "[1/4] Wiping disk structure and partition table on Disk $DiskNumber..." -ForegroundColor Yellow
Clear-Disk -Number $DiskNumber -RemoveData -RemoveOEM -Confirm:$false
Initialize-Disk -Number $DiskNumber -PartitionStyle GPT

Write-Host "[2/4] Creating EFI System Partition (FAT32, Label: POSTCARD_OS)..." -ForegroundColor Yellow
$part = New-Partition -DiskNumber $DiskNumber -UseMaximumSize -AssignDriveLetter
$vol = Format-Volume -Partition $part -FileSystem FAT32 -NewFileSystemLabel "POSTCARD_OS" -Confirm:$false

$driveLetter = $part.DriveLetter + ":"
Write-Host "      Partition mounted at $driveLetter" -ForegroundColor Green

Write-Host "[3/4] Copying Post Card Spatial OS release files and bootloader..." -ForegroundColor Yellow
$destEfi = Join-Path $driveLetter "EFI\BOOT"
$destBoot = Join-Path $driveLetter "boot"
$destScripts = Join-Path $driveLetter "scripts"

New-Item -ItemType Directory -Path $destEfi -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $destBoot "grub") -Force | Out-Null
New-Item -ItemType Directory -Path $destScripts -Force | Out-Null

Copy-Item -Path "$bundleDir\EFI\BOOT\*" -Destination $destEfi -Recurse -Force
Copy-Item -Path "$bundleDir\boot\*" -Destination $destBoot -Recurse -Force
Copy-Item -Path "$bundleDir\grub.cfg" -Destination $driveLetter -Force
Copy-Item -Path "$bundleDir\grub.cfg" -Destination (Join-Path $destBoot "grub\grub.cfg") -Force
Copy-Item -Path "$bundleDir\postcard-kernel" -Destination $driveLetter -Force
Copy-Item -Path "$bundleDir\postcard-kernel-v1.0.4-x86_64" -Destination $driveLetter -Force

if (Test-Path "$bundleDir\scripts") {
    Copy-Item -Path "$bundleDir\scripts\*" -Destination $destScripts -Recurse -Force
}

Write-Host "[4/4] Finalizing filesystem sync and flushing write buffers..." -ForegroundColor Yellow
$sh = New-Object -ComObject Shell.Application
$sh.Namespace(17).ParseName($driveLetter).InvokeVerb("Eject") 2>$null

Write-Host ""
Write-Host "===============================================================================" -ForegroundColor Green
Write-Host "  POST CARD SPATIAL OS HAS BEEN SUCCESSFULLY INSTALLED TO USB!" -ForegroundColor Green
Write-Host "===============================================================================" -ForegroundColor Green
Write-Host "  Drive Letter:      $driveLetter" -ForegroundColor White
Write-Host "  Bootloader:        $driveLetter\EFI\BOOT\BOOTX64.EFI" -ForegroundColor White
Write-Host "  Kernel Binary:     $driveLetter\boot\kernel.elf" -ForegroundColor White
Write-Host ""
Write-Host "  HOW TO BOOT ON BARE-METAL HARDWARE:" -ForegroundColor Cyan
Write-Host "  1. Insert this USB drive into any x86_64 PC (Dell, Lenovo, HP, ASUS, etc.)." -ForegroundColor White
Write-Host "  2. Power on and press the Boot Menu key (F12 on Dell/Lenovo, F9 on HP, F8 on ASUS)." -ForegroundColor White
Write-Host "  3. Select 'UEFI: POSTCARD_OS' or the USB drive from the menu." -ForegroundColor White
Write-Host "  4. Post Card Spatial OS will launch directly into the 3D Glass Cockpit!" -ForegroundColor Green
Write-Host "===============================================================================" -ForegroundColor Green

Write-Host ""
$testBoot = Read-Host "Would you like to test-boot Post Card Spatial OS in QEMU now? (Y/n)"
if ($testBoot -eq '' -or $testBoot.ToLower() -eq 'y') {
    & powershell -ExecutionPolicy Bypass -File (Join-Path $root "boot-postcard-iso.ps1")
}
