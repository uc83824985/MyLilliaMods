@echo off
setlocal
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 22 or newer is required. Install Node.js and run this file again.
  pause
  exit /b 1
)
node "%~dp0sim\chase-lab\launch.mjs"
if errorlevel 1 (
  echo.
  echo Chase Lab could not start. See the error above.
  pause
  exit /b 1
)
exit /b 0
