<#
.SYNOPSIS
    Post Card Spatial OS - Full Unified System Build Pipeline
.DESCRIPTION
    Builds the entire unified stack end-to-end:
    1. IPC Client SDK (integrations/romy-ipc-sdk)
    2. Spatial Glass Cockpit 3D Studio (workspace-prototype: tsc --noEmit && vite build)
    3. Bare-Metal x86_64 Micro-Kernel (kernel/: cargo build --release)
    4. Bootable Multiboot2 Hybrid ISO (target/postcard-spatial-os.iso via WSL)
    5. Live UEFI USB Deployment Bundle (target/usb-deploy-bundle/)
    6. Optional End-to-End Test Suite (-RunTests)
#>

[CmdletBinding()]
param(
    [switch]$RunTests,
    [switch]$SkipUI,
    [switch]$SkipKernel,
    [switch]$SkipIso
)

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
if (-not $root) { $root = Get-Location }

Write-Host "===============================================================================" -ForegroundColor Cyan
Write-Host "         POST CARD SPATIAL OS - FULL UNIFIED BUILD PIPELINE" -ForegroundColor Cyan
Write-Host "===============================================================================" -ForegroundColor Cyan
Write-Host ""

$startTime = Get-Date

# -----------------------------------------------------------------------------
# STEP 1: IPC SDK (integrations/romy-ipc-sdk)
# -----------------------------------------------------------------------------
Write-Host "[1/5] Building IPC Client SDK (integrations/romy-ipc-sdk)..." -ForegroundColor Yellow
$sdkDir = Join-Path $root "integrations\romy-ipc-sdk"
if (Test-Path $sdkDir) {
    Push-Location $sdkDir
    try {
        & cargo check --quiet
        if ($LASTEXITCODE -ne 0) { throw "IPC SDK cargo check failed" }
        Write-Host "      [OK] IPC Client SDK verified." -ForegroundColor Green
    } finally {
        Pop-Location
    }
}

# -----------------------------------------------------------------------------
# STEP 2: Spatial Studio 3D UI (workspace-prototype)
# -----------------------------------------------------------------------------
if (-not $SkipUI) {
    Write-Host "[2/5] Building Spatial Studio 3D UI (workspace-prototype)..." -ForegroundColor Yellow
    $uiDir = Join-Path $root "workspace-prototype"
    if (Test-Path $uiDir) {
        Push-Location $uiDir
        try {
            if (-not (Test-Path "node_modules")) {
                Write-Host "      Installing workspace dependencies..." -ForegroundColor Gray
                & npm install --quiet
            }
            & npm run build
            if ($LASTEXITCODE -ne 0) { throw "Spatial Studio UI build failed" }
            Write-Host "      [OK] Spatial Studio UI bundled (dist/)." -ForegroundColor Green
        } finally {
            Pop-Location
        }
    }
} else {
    Write-Host "[2/5] Skipping Spatial Studio UI build (-SkipUI specified)." -ForegroundColor DarkGray
}

# -----------------------------------------------------------------------------
# STEP 3: Bare-Metal Micro-Kernel (kernel/)
# -----------------------------------------------------------------------------
if (-not $SkipKernel) {
    Write-Host "[3/5] Compiling Bare-Metal Micro-Kernel (kernel/)..." -ForegroundColor Yellow
    $kernelDir = Join-Path $root "kernel"
    Push-Location $kernelDir
    try {
        & cargo build --release --target x86_64-unknown-none --target-dir "$root\target"
        if ($LASTEXITCODE -ne 0) { throw "Kernel compilation failed" }
        Write-Host "      [OK] Bare-metal kernel compiled." -ForegroundColor Green
    } finally {
        Pop-Location
    }

    # Verify Multiboot2 ELF via WSL
    Write-Host "      Verifying Multiboot2 ELF conformance via WSL..." -ForegroundColor Gray
    $kernelPathWsl = "/mnt/g/micro-host/target/x86_64-unknown-none/release/postcard-minimal-kernel"
    & wsl bash -c "grub-file --is-x86-multiboot2 $kernelPathWsl"
    if ($LASTEXITCODE -eq 0) {
        Write-Host "      [OK] Multiboot2 ELF header verified." -ForegroundColor Green
    } else {
        throw "Kernel ELF failed Multiboot2 verification"
    }
} else {
    Write-Host "[3/5] Skipping Kernel build (-SkipKernel specified)." -ForegroundColor DarkGray
}

# -----------------------------------------------------------------------------
# STEP 4: Bootable Multiboot2 Hybrid ISO & USB Bundle
# -----------------------------------------------------------------------------
if (-not $SkipIso) {
    Write-Host "[4/5] Generating Bootable Hybrid ISO & Refreshing USB Bundle..." -ForegroundColor Yellow
    & wsl bash -c "cd /mnt/g/micro-host && bash scripts/create_iso.sh"
    if ($LASTEXITCODE -ne 0) { throw "ISO creation script failed" }

    # Refresh USB bundle files
    $kernelElf = Join-Path $root "target\x86_64-unknown-none\release\postcard-minimal-kernel"
    $usbBundle = Join-Path $root "target\usb-deploy-bundle"
    if ((Test-Path $kernelElf) -and (Test-Path $usbBundle)) {
        Copy-Item -Path $kernelElf -Destination (Join-Path $usbBundle "postcard-kernel") -Force
        Copy-Item -Path $kernelElf -Destination (Join-Path $usbBundle "postcard-kernel-v1.0.4-x86_64") -Force
        Copy-Item -Path $kernelElf -Destination (Join-Path $usbBundle "boot\kernel.elf") -Force
        Copy-Item -Path $kernelElf -Destination (Join-Path $usbBundle "boot\postcard-kernel-v1.0.4-x86_64") -Force
        # Also refresh live demo ISO alias
        $isoSrc = Join-Path $root "target\postcard-spatial-os.iso"
        $isoDst = Join-Path $root "target\postcard-spatial-os-live-demo.iso"
        if (Test-Path $isoSrc) {
            Copy-Item -Path $isoSrc -Destination $isoDst -Force
        }
        Write-Host "      [OK] USB Deployment bundle and Live Demo ISO refreshed." -ForegroundColor Green
    }
} else {
    Write-Host "[4/5] Skipping ISO creation (-SkipIso specified)." -ForegroundColor DarkGray
}

# -----------------------------------------------------------------------------
# STEP 5: Verification Tests (Optional: -RunTests)
# -----------------------------------------------------------------------------
if ($RunTests) {
    Write-Host "[5/5] Executing End-to-End System Tests..." -ForegroundColor Yellow
    
    # Run UI tests
    Write-Host "      Running Workspace Prototype unit tests (63 tests)..." -ForegroundColor Gray
    Push-Location (Join-Path $root "workspace-prototype")
    try {
        & npm test
        if ($LASTEXITCODE -ne 0) { throw "Workspace UI tests failed" }
    } finally {
        Pop-Location
    }
    
    # Run QEMU Serial Shell tests via WSL
    Write-Host "      Running QEMU Serial Shell test suite (159 tests)..." -ForegroundColor Gray
    & wsl bash -c "cd /mnt/g/micro-host && bash scripts/shell_test.sh -t 40"
    if ($LASTEXITCODE -ne 0) { throw "QEMU Serial Shell tests failed" }
    
    Write-Host "      [OK] All test suites passed with 100% success rate." -ForegroundColor Green
} else {
    Write-Host "[5/5] Skipping test runs (pass -RunTests to run full QEMU & UI test suites)." -ForegroundColor DarkGray
}

$elapsed = (Get-Date) - $startTime
Write-Host ""
Write-Host "===============================================================================" -ForegroundColor Green
Write-Host ("  FULL UNIFIED BUILD COMPLETED SUCCESSFULLY in {0:N1}s!" -f $elapsed.TotalSeconds) -ForegroundColor Green
Write-Host "  Bootable ISO: target\postcard-spatial-os.iso" -ForegroundColor White
Write-Host "  Live USB:     target\usb-deploy-bundle\" -ForegroundColor White
Write-Host "  Launch OS:    .\boot-postcard-iso.ps1" -ForegroundColor Cyan
Write-Host "  Studio Web:   .\launch-postcard-os.ps1" -ForegroundColor Cyan
Write-Host "===============================================================================" -ForegroundColor Green
