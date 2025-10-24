# Setup Frontend Environment
@echo off
echo Setting up Frontend...

cd frontend

echo Installing dependencies...
call npm install

echo Copying environment file...
copy .env.example .env

echo.
echo Frontend setup complete!
echo.

cd ..
