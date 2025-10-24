# Setup Backend Environment
@echo off
echo Setting up Backend...

cd backend

echo Creating virtual environment...
python -m venv venv

echo Activating virtual environment...
call venv\Scripts\activate.bat

echo Installing dependencies...
pip install -e .
pip install -e ".[dev]"

echo Copying environment file...
copy .env.example .env

echo.
echo Backend setup complete!
echo Edit backend\.env to configure MongoDB connection
echo.

cd ..
