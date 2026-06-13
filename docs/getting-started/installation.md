# Installation

*Get APIWeave running on Windows or macOS/Linux. Pick the one-shot quick start, the manual path, or Docker Compose, then verify each service is up before you build your first workflow.*

## Prerequisites

Install these on your machine before any path below works.

- Python 3.13 or newer. The backend uses 3.13+ syntax and type features.
- Node.js 20 or newer, plus npm. The frontend uses Vite 5 and React 18.
- MongoDB 7 or newer, running locally on port 27017, or a connection string to MongoDB Atlas.
- Git, to clone the repository.

Hardware: roughly 4 GB of free RAM and 5 GB of disk for the Python virtualenv, `node_modules`, and MongoDB data files.

Pick the path that matches your machine. If you want zero configuration on your host, skip to [Docker Compose](#docker-compose). If you want to edit code and see live reload, use [Quick Start](#quick-start) or [Manual Installation](#manual-installation).

## Quick Start

The one-shot scripts create the Python virtualenv, install Python and npm dependencies, and copy `.env.example` to `.env` for both services. Run them once, then start the dev stack.

Windows (PowerShell or Command Prompt):

```bat
setup.bat
start-dev.bat
```

macOS/Linux:

```bash
chmod +x setup.sh start-dev.sh
./setup.sh
./start-dev.sh
```

What the scripts do:

- `setup.bat` and `setup.sh` chain `setup-backend.*` and `setup-frontend.*`. The backend step creates `backend/venv`, runs `pip install -e ".[dev]"`, and copies `backend/.env.example` to `backend/.env`. The frontend step runs `npm install` in `frontend/` and copies `frontend/.env.example` to `frontend/.env`.
- `start-dev.bat` and `start-dev.sh` start MongoDB if it is not already running, then open a separate window for the backend API, the worker, the MCP stdio server, and the frontend dev server.

To stop everything, run `stop-dev.bat` (Windows) or `./stop-dev.sh` (macOS/Linux). The stop script closes the windows the start script opened.

## Manual Installation

Use this path if you want full control over each step, or if the quick start script fails on your platform.

### Backend

Windows (PowerShell):

```powershell
cd backend
python -m venv venv
.\venv\Scripts\Activate.ps1
pip install --upgrade pip
pip install -e ".[dev]"
copy .env.example .env
```

macOS/Linux:

```bash
cd backend
python3 -m venv venv
source venv/bin/activate
pip install --upgrade pip
pip install -e ".[dev]"
cp .env.example .env
```

The editable install (`-e .`) means source changes in `backend/app/` show up on the next server reload, with no reinstall.

### Frontend

Windows:

```bat
cd frontend
npm install
copy .env.example .env
```

macOS/Linux:

```bash
cd frontend
npm install
cp .env.example .env
```

### MongoDB

Pick one of these three options.

Local install on Windows, using winget (run PowerShell as Administrator):

```powershell
winget install MongoDB.Server
```

The default data directory is `C:\data\db`. If the installer put the binaries elsewhere, add the `bin` folder to your system `PATH`.

Local install on macOS, using Homebrew:

```bash
brew tap mongodb/brew
brew install mongodb-community@7.0
brew services start mongodb-community@7.0
```

Local install on Debian or Ubuntu, using the official apt repository:

```bash
sudo apt-get install -y mongodb-org
sudo systemctl start mongod
```

If you do not want MongoDB on your machine, create a free cluster at [MongoDB Atlas](https://www.mongodb.com/cloud/atlas) and paste the connection string into `MONGODB_URL` in `backend/.env`. The connection string must end with the database name:

```env
MONGODB_URL=mongodb+srv://user:pass@cluster0.example.net/apiweave
```

## Docker Compose

Docker Compose runs MongoDB, the backend, the worker, the MCP stdio helper, and the frontend in containers, with hot-reload mounts for the source code. Use this path when you want identical behavior across machines, or when you cannot install Python 3.13 or MongoDB locally.

From the project root:

```bash
docker compose up -d --build
docker compose ps
```

The compose file lives at the project root and defines five services: `mongodb`, `backend`, `worker`, `mcp-stdio`, and `frontend`. The first build takes a few minutes; later builds are fast because of layer caching.

Follow logs for one service:

```bash
docker compose logs -f backend
```

Stop and remove the containers while keeping the MongoDB data volume:

```bash
docker compose down
```

Wipe the MongoDB data volume too:

```bash
docker compose down -v
```

## Configuration

Both services read a `.env` file at startup. The setup scripts copy `.env.example` to `.env` for you. Edit the values you need; the defaults work for local development.

### backend/.env

Minimum values to confirm:

```env
APP_ENV=development
BASE_URL=http://localhost:8000
FRONTEND_URL=http://localhost:3000
MONGODB_URL=mongodb://localhost:27017
MONGODB_DB_NAME=apiweave
ALLOWED_ORIGINS=http://localhost:3000,http://localhost:5173
SECRET_KEY=change-me-in-development
```

For OAuth login (GitHub, GitLab, Google, Microsoft), fill in the `*_CLIENT_ID` and `*_CLIENT_SECRET` variables. The first successful SSO login becomes the admin when `SETUP_MODE_ENABLED=true` and no users exist. Production deployment values live in the [Authentication Setup](../operations/authentication.md) guide; do not reuse development secrets in production.

### frontend/.env

Two variables, both pointing at the backend:

```env
VITE_API_URL=http://localhost:8000
VITE_API_WEAVE_URL=http://localhost:8000
```

These are baked into the JavaScript bundle at build time. If you change a `VITE_*` value, restart `npm run dev` or run `npm run build` to pick it up. A dev-server restart is not enough on its own.

## Verify Installation

Run these checks in order. Each one confirms a layer of the stack is reachable.

1. Confirm the backend health endpoint:

   ```bash
   curl http://localhost:8000/health
   ```

   Expected response: `{"status":"ok"}` or similar JSON with a `status` field. If you get connection refused, the backend is not running yet. Re-run `start-dev` or check the backend window for stack traces.

2. Confirm the OpenAPI docs load:

   Open `http://localhost:8000/docs` in a browser. You should see the FastAPI Swagger UI with route groups for workflows, runs, environments, collections, and webhooks.

3. Confirm the frontend responds:

   Open `http://localhost:3000` in a browser. The APIWeave home page should render with the workflow sidebar and an empty canvas.

4. Confirm MongoDB is reachable from your shell:

   ```bash
   mongosh --eval "db.runCommand({ ping: 1 })" mongodb://localhost:27017/apiweave
   ```

   Expected response: `{ ok: 1 }`. If you use the legacy `mongo` shell, the command is the same; only the binary name differs.

5. Confirm the worker is alive (Docker or manual):

   ```bash
   docker compose logs worker | tail -20
   ```

   Look for a line that says the worker started and is polling for runs. In a manual setup, the equivalent line appears in the Worker window opened by `start-dev`.

If all five checks pass, your installation is good. You are ready to build a workflow.

## Next Steps

Move on to [Your First Workflow](first-workflow.md) for a 5-minute tour of the canvas: drag an HTTP Request node onto it, add an assertion, and run the workflow. If you would rather read the building blocks first, [Concepts](concepts.md) defines every term you will see in the rest of the docs.

## Troubleshooting

- **If `setup.bat` reports `'python' is not recognized`**, Python 3.13 is not on `PATH`. Reinstall Python from python.org and tick "Add Python to PATH" in the first installer screen, or use the Microsoft Store install on Windows 11.
- **If `start-dev.bat` says `mongod: command not found`**, the MongoDB `bin` directory is not on `PATH`. Add `C:\Program Files\MongoDB\Server\7.0\bin` (or wherever the installer placed it) to your system `PATH`, or start `mongod` manually with `--dbpath C:\data\db` in a separate terminal.
- **If the frontend shows "Network Error" or a CORS error in the browser console**, the backend is not running, or `ALLOWED_ORIGINS` in `backend/.env` does not include `http://localhost:3000`. Edit `.env`, restart the backend, and refresh the page.
- **If port 8000 or port 3000 is already in use**, another app is holding the port. Stop that app, or change the port: pass `--port 8001` to `uvicorn` for the backend, and edit `VITE_API_URL` in `frontend/.env` plus the dev-server port in `frontend/vite.config.js` to match.
- **If Docker Compose fails with "port is already allocated"**, an old container or host process is still on 27017, 8000, or 3000. Run `docker compose down` then `docker compose up -d --build` again.
- **If `mongosh` cannot reach the database inside Docker**, the backend container uses the compose network name `mongodb`. From your host shell, the same MongoDB is reachable at `mongodb://localhost:27017` because the compose file maps the port.

## Related

- [Your First Workflow](first-workflow.md)
- [Concepts](concepts.md)
- [Workflows and Nodes](../features/workflows-and-nodes.md)
- [Environment Variables Reference](../reference/environment-variables.md)
