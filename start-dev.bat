@echo off
echo Starting APIWeave desktop app...
echo.
cd /d "%~dp0desktop"
call npm run dev
