@echo off
setlocal
cd /d "%~dp0"
set "LOG=%LOCALAPPDATA%\Westcott\start.log"
if not exist "%LOCALAPPDATA%\Westcott" mkdir "%LOCALAPPDATA%\Westcott"
echo ==== %date% %time% ==== > "%LOG%"
echo 目录: %cd% >> "%LOG%"

where node >nul 2>nul
if errorlevel 1 if exist "%ProgramFiles%\nodejs\node.exe" set "PATH=%ProgramFiles%\nodejs;%PATH%"
where node >> "%LOG%" 2>&1
if errorlevel 1 goto no_node

rem Claude Code 不在 PATH 时，依次查找常见安装位置。
where claude >nul 2>nul
if errorlevel 1 if exist "%USERPROFILE%\.local\bin\claude.exe" set "PATH=%USERPROFILE%\.local\bin;%PATH%"
where claude >nul 2>nul
if errorlevel 1 if exist "%APPDATA%\npm\claude.cmd" set "PATH=%APPDATA%\npm;%PATH%"
where claude >nul 2>nul
if errorlevel 1 if exist "%LOCALAPPDATA%\Microsoft\WinGet\Links\claude.exe" set "PATH=%LOCALAPPDATA%\Microsoft\WinGet\Links;%PATH%"
where claude >> "%LOG%" 2>&1
if errorlevel 1 goto no_claude

echo 启动总导演 >> "%LOG%"
call claude --agent westcott-director
set "CODE=%errorlevel%"
echo 退出代码: %CODE% >> "%LOG%"
if "%CODE%"=="0" exit /b 0
echo.
echo Claude Code 异常退出（代码 %CODE%）。
echo 日志: %LOG%
pause
exit /b %CODE%

:no_node
echo 找不到 Node.js >> "%LOG%"
echo 找不到 Node.js。请安装 Node.js LTS 后重新双击本文件。
pause
exit /b 1

:no_claude
echo 找不到 Claude Code >> "%LOG%"
echo 找不到 Claude Code。请按 README 安装后重新双击本文件。
pause
exit /b 1
