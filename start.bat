@echo off
REM AdamN NMS launcher (Windows)
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required ^(version 22.13 or newer^). Download it from https://nodejs.org
  pause
  exit /b 1
)
if not exist node_modules (
  echo Installing dependencies for the first time...
  call npm install --no-audit --no-fund
)
set HOST=127.0.0.1
set PORT=4000
set ADAMN_OPEN=1
call npm start
pause
