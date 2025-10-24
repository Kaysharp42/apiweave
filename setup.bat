# Complete Setup for APIWeave
@echo off
echo ========================================
echo   APIWeave - Complete Setup
echo ========================================
echo.

REM Setup Backend
call setup-backend.bat

echo.
echo ========================================

REM Setup Frontend  
call setup-frontend.bat

echo.
echo ========================================
echo.
echo Setup Complete!
echo.
echo Next steps:
echo 1. Make sure MongoDB is installed and running
echo 2. Run: start-dev.bat
echo.
pause
