# APIWeave

APIWeave is a visual API testing workspace where you build test flows on a canvas, run them, and inspect results node-by-node.

## What You Can Do

- Build workflows with drag-and-drop nodes (HTTP, assertion, delay, merge, start/end).
- Chain requests by extracting values from responses and reusing them in later steps.
- Manage environments and secrets for dev/stage/prod testing.
- Import request templates from OpenAPI/Swagger, HAR, and cURL.
- Organize workflows into collections.
- Trigger runs manually or through webhooks for CI/CD pipelines.

## Quick Start

### Prerequisites

- Python 3.13+
- Node.js 20+
- MongoDB 7+

### 1) Set Up

Windows:

```bash
setup.bat
```

macOS/Linux:

```bash
./setup.sh
```

If you prefer manual setup, copy environment files first:

- `backend/.env.example` -> `backend/.env`
- `frontend/.env.example` -> `frontend/.env`

### 2) Start Development Services

Windows:

```bash
start-dev.bat
```

macOS/Linux:

```bash
./start-dev.sh
```

Default local URLs:

- Frontend: `http://localhost:3000`
- Backend API: `http://localhost:8000`
- OpenAPI docs: `http://localhost:8000/docs`

### 3) Stop Services

Windows:

```bash
stop-dev.bat
```

macOS/Linux:

```bash
./stop-dev.sh
```

## First Workflow (5 Minutes)

1. Open `http://localhost:3000`.
2. Create a new workflow.
3. Drag an HTTP Request node onto the canvas and configure URL/method.
4. Add an Assertion node and connect it.
5. Run the workflow and inspect node execution results.

## Documentation

Start here:

- [Documentation Hub](docs/README.md)
- [Navigation Guide](docs/NAVIGATION.md)

Current guides:

- [Workflows and Nodes Guide](docs/WORKFLOWS_AND_NODES.md)
- [Variables, Extractors, and JSON Editor](docs/VARIABLES_EXTRACTORS_JSON_EDITOR.md)
- [Environments, Secrets, and Collections](docs/ENVIRONMENTS_COLLECTIONS.md)
- [Variables and Data Passing](docs/VARIABLES.md)
- [Workflow Variables Quick Start](docs/WORKFLOW_VARIABLES_QUICKSTART.md)
- [Workflow Variables Reference](docs/WORKFLOW_VARIABLES.md)
- [Swagger and OpenAPI Import Guide](docs/SWAGGER_UI_BASE_URL_IMPORT.md)
- [Webhook Quick Start](docs/WEBHOOK_QUICKSTART.md)

## Tech Stack

- Frontend: React, React Flow, Zustand, Tailwind, DaisyUI
- Backend: FastAPI, Beanie (MongoDB ODM), Motor
- Worker: Python async worker processing workflow runs
- Database: MongoDB

## Project Layout

```text
apiweave/
  backend/   FastAPI API, worker, data models
  frontend/  React app and workflow canvas UI
  docs/      User-facing documentation
  progress/  Internal implementation notes and history
```

## License

MIT - see `LICENSE`.
