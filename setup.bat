# Setup APIWeave Desktop (single-process Electron)
@echo off
echo ========================================
echo   APIWeave - Setup
echo ========================================
echo.

REM Check Node.js 20+
where node >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo ERROR: Node.js not found. Install Node.js 20+ from https://nodejs.org
    pause
    exit /b 1
)
for /f "tokens=1" %%v in ('node -v') do set NODE_VER=%%v
echo Node.js %NODE_VER% detected

echo.
echo Installing frontend dependencies...
cd /d "%~dp0frontend"
call npm install
if %ERRORLEVEL% neq 0 (
    echo ERROR: Frontend npm install failed
    pause
    exit /b 1
)

echo.
echo Installing desktop dependencies...
cd /d "%~dp0desktop"
call npm install
if %ERRORLEVEL% neq 0 (
    echo ERROR: Desktop npm install failed
    pause
    exit /b 1
)

echo.
echo Rebuilding native modules for Electron...
call npm run rebuild:electron
if %ERRORLEVEL% neq 0 (
    echo WARNING: electron-rebuild failed (may need Visual Studio Build Tools)
)

echo.
echo ========================================
echo Setup complete!
echo.
echo Run: start-dev.bat
echo.
pause
