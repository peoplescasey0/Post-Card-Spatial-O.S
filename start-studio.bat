@echo off
setlocal enabledelayedexpansion
title Post Card Spatial OS - Studio Launcher
cls

echo ===============================================================================
echo                POST CARD SPATIAL OS - 3D HYPERVISOR STUDIO
echo ===============================================================================
echo.
echo  [*] Verifying runtime prerequisites...

where node >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Node.js is not found in PATH!
    echo Please install Node.js (v18+ recommended) from https://nodejs.org/
    echo.
    pause
    exit /b 1
)

cd /d "%~dp0workspace-prototype"
if not exist "package.json" (
    echo [ERROR] Cannot find workspace-prototype directory!
    echo Please make sure this file is placed at the root of the repository.
    echo.
    pause
    exit /b 1
)

if not exist "node_modules" (
    echo [*] Installing workspace dependencies (first run only)...
    call npm install
)

echo [*] Checking Studio server status on port 5173...
netstat -ano | findstr /R /C:":5173 .*LISTENING" >nul 2>nul
if %ERRORLEVEL% equ 0 (
    echo [OK] Studio server is already running!
    goto launch_browser
)

echo [*] Starting Studio background dev server on http://localhost:5173/ ...
start "Post Card Studio Dev Server" /min cmd /c "npm run dev"

echo [*] Waiting for Studio server to bind...
for /L %%i in (1,1,15) do (
    timeout /t 1 /nobreak >nul
    netstat -ano | findstr /R /C:":5173 .*LISTENING" >nul 2>nul
    if !ERRORLEVEL! equ 0 (
        echo [OK] Studio server is ready!
        goto launch_browser
    )
)

:launch_browser
echo [*] Launching 3D Spatial OS Studio in your default browser...
start http://localhost:5173/

echo.
echo ===============================================================================
echo  [READY] Studio URL: http://localhost:5173/
echo  - Press WASD or 1-6 keys for 6-way card flips
echo  - Drag or fling cards around the turntable
echo  - Fold and throw Paper Airplanes across cards or live network
echo  - Press [T] for In-Place 3D Face-Off Twist
echo  - Press [?] for the Operator Field Guide
echo ===============================================================================
echo.
echo You may minimize this window. Press any key to exit launcher.
pause >nul
