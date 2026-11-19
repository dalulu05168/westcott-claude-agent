@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Install Node.js LTS and reopen this file.
  pause
  exit /b 1
)
where claude >nul 2>nul
if errorlevel 1 (
  echo Claude Code was not found. Install Claude Code and reopen this file.
  pause
  exit /b 1
)
call claude --agent westcott-director
