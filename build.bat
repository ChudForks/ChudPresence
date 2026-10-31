@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required to package the extension. Use Node.js 24.21.0 to match CI.
  exit /b 1
)

call npm run check
if errorlevel 1 exit /b 1
call npm test
if errorlevel 1 exit /b 1
call npm run build
if errorlevel 1 exit /b 1

echo.
echo Extension package written to dist.
