@echo off
setlocal

set "SCRIPT_DIR=%~dp0"
set "SETUP_FILE="
set "LOG_FILE=%SCRIPT_DIR%update-local.log"

for /f "delims=" %%F in ('dir /b /o-n "%SCRIPT_DIR%Universitet Kiosk Setup *.exe" 2^>nul') do (
    set "SETUP_FILE=%%F"
    goto :found
)

:found
if not defined SETUP_FILE (
    echo Setup file not found.
    echo Put this file in the same folder as: Universitet Kiosk Setup *.exe
    echo.
    pause
    exit /b 1
)

echo Using setup: %SETUP_FILE%
echo Log file: %LOG_FILE%
echo ===== %DATE% %TIME% ===== > "%LOG_FILE%"
powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%update-client.ps1" -LocalSetupPath "%SCRIPT_DIR%%SETUP_FILE%" >> "%LOG_FILE%" 2>&1
set "RC=%ERRORLEVEL%"
echo.
echo ===== RESULT (exit code %RC%) =====
type "%LOG_FILE%"
echo.
echo Exit code: %RC%
echo Log saved: %LOG_FILE%
pause
exit /b %RC%
