@echo off
echo Stopping APIWeave services...

REM Kill processes on port 8000 (Backend)
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :8000') do taskkill /F /PID %%a 2>NUL

REM Kill processes on port 3000 (Frontend)
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :3000') do taskkill /F /PID %%a 2>NUL

echo All services stopped!
