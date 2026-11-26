@echo off
setlocal
set "SCRIPT_DIR=%~dp0"
if "%SCRIPT_DIR:~-1%"=="\" set "SCRIPT_DIR=%SCRIPT_DIR:~0,-1%"
set "SCRIPT_FILE=%~f0"
set "WT_ARGS=%*"

net session >nul 2>&1
if not "%ERRORLEVEL%"=="0" (
    echo [WT Tactical Map] Requesting Administrator privileges...
    powershell -NoProfile -ExecutionPolicy Bypass -Command "$d=$env:SCRIPT_DIR; $f=$env:SCRIPT_FILE; $a=$env:WT_ARGS; $c='/c cd /d \"'+$d+'\" && call \"'+$f+'\"'; if($a){$c+=' '+$a}; Start-Process -FilePath 'cmd.exe' -ArgumentList $c -WorkingDirectory $d -Verb RunAs"
    if errorlevel 1 (
        echo [ERROR] Administrator elevation was canceled or failed.
        pause
        exit /b 1
    )
    exit /b 0
)

cd /d "%SCRIPT_DIR%"

if exist "%SCRIPT_DIR%\WT_Tactical_Map.exe" (
    echo [WT Tactical Map v2.0] Starting Go single-file server...
    echo Tip: run "start.bat --mock" for offline preview mode.
    echo.
    "%SCRIPT_DIR%\WT_Tactical_Map.exe" %*
    set "EXIT_CODE=%ERRORLEVEL%"
    if not "%EXIT_CODE%"=="0" (
        echo.
        echo [ERROR] Server exited unexpectedly ^(exit code %EXIT_CODE%^).
        pause
    )
    endlocal
    exit /b %EXIT_CODE%
)

if not exist "%SCRIPT_DIR%\server.py" (
    echo [ERROR] Neither WT_Tactical_Map.exe nor server.py found in %SCRIPT_DIR%
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
    echo [ERROR] Python 3 not found. Please install Python 3 or place WT_Tactical_Map.exe here.
    pause
    exit /b 1
)

echo [WT Tactical Map] Starting Python fallback server...
"%PY_CMD%" "%SCRIPT_DIR%\server.py" %*
set "EXIT_CODE=%ERRORLEVEL%"
if not "%EXIT_CODE%"=="0" (
    echo.
    echo [ERROR] Server exited unexpectedly ^(exit code %EXIT_CODE%^).
    pause
)
endlocal
