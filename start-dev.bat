@echo off
echo Starting APIWeave Development Environment...

REM Start MongoDB (if not running)
tasklist /FI "IMAGENAME eq mongod.exe" 2>NUL | find /I /N "mongod.exe">NUL
if "%ERRORLEVEL%"=="1" (
    echo Starting MongoDB...
    start "MongoDB" mongod --dbpath C:\data\db
    timeout /t 3 /nobreak > NUL
) else (
    echo MongoDB already running
)

REM Start Backend API
echo Starting Backend API...
start "Backend API" cmd /k "cd backend && venv\Scripts\activate && uvicorn app.main:app --reload --host 0.0.0.0 --port 8000"

timeout /t 2 /nobreak > NUL

REM Start Worker
echo Starting Worker...
start "Worker" cmd /k "cd backend && venv\Scripts\activate && python -m app.worker"

timeout /t 2 /nobreak > NUL

REM Start Frontend
echo Starting Frontend...
start "Frontend" cmd /k "cd frontend && npm run dev"

timeout /t 3 /nobreak > NUL

echo.
echo All services started!
echo.
echo Frontend:  http://localhost:3000
echo Backend:   http://localhost:8000
echo API Docs:  http://localhost:8000/docs
echo.
