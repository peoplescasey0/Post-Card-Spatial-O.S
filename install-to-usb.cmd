@echo off
setlocal
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-to-usb.ps1" %*
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo Installation script exited with error code %ERRORLEVEL%.
)
pause
