# APIWeave - Local Development Setup

## Prerequisites

- Python 3.13+
- Node.js 20+
- MongoDB 7+ (installed locally or running service)
- PowerShell (Windows) or Bash (Linux/Mac)

## Initial Setup

### 1. Install MongoDB Locally

**Windows (using Chocolatey):**
```powershell
choco install mongodb
# Or download from https://www.mongodb.com/try/download/community
```

**Start MongoDB:**
```powershell
# As a service (if installed as service)
net start MongoDB

# Or run manually
mongod --dbpath C:\data\db
```

### 2. Backend Setup

```powershell
# Navigate to backend
cd backend

# Create virtual environment
python -m venv venv

# Activate virtual environment
.\venv\Scripts\activate  # Windows PowerShell
# source venv/bin/activate  # Linux/Mac

# Install dependencies
pip install -e .
pip install -e ".[dev]"  # Include dev dependencies

# Copy environment file
copy .env.example .env

# Edit .env and update MongoDB URL
# MONGODB_URL=mongodb://localhost:27017
```

### 3. Frontend Setup

```powershell
# Navigate to frontend (open new terminal)
cd frontend

# Install dependencies
npm install
```

## Running the Application

You'll need **3 terminals**:

### Terminal 1: MongoDB
```powershell
# If not running as service
mongod --dbpath C:\data\db
```

### Terminal 2: Backend API
```powershell
cd backend
.\venv\Scripts\activate
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Backend will be available at:
- API: http://localhost:8000
- Docs: http://localhost:8000/docs
- Health: http://localhost:8000/health

### Terminal 3: Worker (Background Job Processor)
```powershell
cd backend
.\venv\Scripts\activate
python -m app.worker
```

### Terminal 4: Frontend
```powershell
cd frontend
npm run dev
```

Frontend will be available at: http://localhost:3000

## Development Workflow

### Backend Development

```powershell
cd backend
.\venv\Scripts\activate

# Run with auto-reload
uvicorn app.main:app --reload

# Run tests
pytest

# Run tests with coverage
pytest --cov=app --cov-report=html

# Format code
black app/
ruff check app/

# Type check
mypy app/
```

### Frontend Development

```powershell
cd frontend

# Development server (with hot reload)
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview

# Lint
npm run lint

# Format
npm run format
```

## Database Management

### Access MongoDB Shell
```powershell
mongosh
use apiweave
db.workflows.find()
db.runs.find()
```

### Reset Database
```powershell
mongosh
use apiweave
db.dropDatabase()
```

## Troubleshooting

### MongoDB Connection Issues
- Ensure MongoDB is running: `mongod --version`
- Check connection URL in `.env`
- Verify MongoDB is listening on port 27017

### Python Virtual Environment Issues
```powershell
# Recreate virtual environment
Remove-Item -Recurse -Force venv
python -m venv venv
.\venv\Scripts\activate
pip install -e .
```

### Frontend Port Already in Use
```powershell
# Kill process on port 3000
# Find process
netstat -ano | findstr :3000
# Kill it (replace PID)
taskkill /PID <PID> /F
```

### Backend Port Already in Use
```powershell
# Kill process on port 8000
netstat -ano | findstr :8000
taskkill /PID <PID> /F
```

## Quick Start Script

Create `start-dev.ps1` in the root:

```powershell
# Start all services in separate windows

# Start MongoDB (if not a service)
Start-Process powershell -ArgumentList "-NoExit", "-Command", "mongod --dbpath C:\data\db"

# Wait for MongoDB
Start-Sleep -Seconds 3

# Start Backend
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd backend; .\venv\Scripts\activate; uvicorn app.main:app --reload"

# Start Worker
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd backend; .\venv\Scripts\activate; python -m app.worker"

# Start Frontend
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd frontend; npm run dev"

Write-Host "✅ All services started!"
Write-Host "Frontend: http://localhost:3000"
Write-Host "Backend: http://localhost:8000"
Write-Host "API Docs: http://localhost:8000/docs"
```

Run with:
```powershell
.\start-dev.ps1
```

## Project Structure

```
apiweave/
├── backend/           # Python FastAPI backend
│   ├── app/
│   │   ├── main.py           # FastAPI app entry point
│   │   ├── config.py         # Configuration
│   │   ├── database.py       # MongoDB connection
│   │   ├── models/           # Pydantic models
│   │   ├── api/              # API routes
│   │   ├── runner/           # Workflow executor
│   │   └── reporters/        # JUnit/HTML reporters
│   └── tests/                # Pytest tests
│
├── frontend/          # React frontend
│   └── src/
│       ├── main.jsx          # Entry point
│       ├── App.jsx           # Main app
│       ├── components/       # React components
│       ├── pages/            # Page components
│       └── services/         # API client
│
└── shared/            # Shared schemas
```

## Next Steps

1. ✅ Setup complete - all services running
2. 📝 Start building workflow models (Phase 2)
3. 🎨 Build visual canvas editor (Phase 4)
4. 🧪 Write tests
5. 📚 Add documentation

## Environment Variables

Backend `.env`:
```env
DEBUG=true
MONGODB_URL=mongodb://localhost:27017
MONGODB_DB_NAME=apiweave
ALLOWED_ORIGINS=http://localhost:3000,http://localhost:5173
SECRET_KEY=your-secret-key-change-in-production
WORKER_POLL_INTERVAL=5
WORKER_MAX_RETRIES=3
ARTIFACTS_PATH=./artifacts
```

Frontend `.env`:
```env
VITE_API_URL=http://localhost:8000
```

---

**Happy Coding! 🚀**
