@echo off
setlocal
cd /d "%~dp0"

if not exist "%~dp0server.py" (
    echo [ERROR] server.py not found in %~dp0
    pause
    exit /b 1
)

set "PY_CMD="
python --version >nul 2>nul
if not errorlevel 1 (
    set "PY_CMD=python"
) else (
    py -3 --version >nul 2>nul
    if not errorlevel 1 (
        set "PY_CMD=py -3"
    )
)

if "%PY_CMD%"=="" (
    echo [ERROR] Python 3 not found. Please install Python 3 and add it to PATH.
    pause
    exit /b 1
)

echo [WT Tactical Map] Starting local server...
echo Tip: run "start.bat --mock" for offline preview mode.
echo.

%PY_CMD% "%~dp0server.py" %*
set "EXIT_CODE=%ERRORLEVEL%"
if not "%EXIT_CODE%"=="0" (
    echo.
    echo [ERROR] Server exited unexpectedly ^(exit code %EXIT_CODE%^).
    pause
)
endlocal
