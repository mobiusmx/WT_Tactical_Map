@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

if not exist "%~dp0server.py" (
    echo [错误] 未找到 server.py，请确认 start.bat 与 server.py 在同一目录。
    pause
    exit /b 1
)

set "PY_CMD="
where python >nul 2>nul
if not errorlevel 1 (
    set "PY_CMD=python"
) else (
    where py >nul 2>nul
    if not errorlevel 1 (
        set "PY_CMD=py -3"
    )
)

if "%PY_CMD%"=="" (
    echo [错误] 未找到 Python 3 环境，请先安装 Python 3 并勾选 Add to PATH。
    pause
    exit /b 1
)

echo [WT 战术走线副屏] 正在启动本地服务...
echo 提示：如需离线测试界面与走线绘制，可运行：start.bat --mock
echo.

%PY_CMD% "%~dp0server.py" %*
set "EXIT_CODE=%ERRORLEVEL%"
if not "%EXIT_CODE%"=="0" (
    echo.
    echo [错误] 服务异常退出 ^(exit code %EXIT_CODE%^)
    pause
)
endlocal
