# APIWeave

Visual API Test Story Builder. Build, run, and inspect API test workflows on a canvas.

## What Is APIWeave?

APIWeave is a self-hostable, open-source workspace for visual API testing. You assemble test workflows on a ReactFlow canvas from drag-and-drop nodes (HTTP request, assertion, delay, merge, start, end), chain requests with extracted variables and dynamic functions, run them against any environment, and inspect results node by node. Workflows group into collections, environments hold variables and secret keys, and webhooks let CI/CD trigger runs without a manual click.

## Quick Start

Prerequisites: Python 3.13+, Node.js 20+, MongoDB 7+.

Windows:

```bash
setup.bat
start-dev.bat
```

macOS / Linux:

```bash
./setup.sh
./start-dev.sh
```

Open `http://localhost:3000` in a browser. The frontend is on port 3000, the backend API on port 8000, the OpenAPI docs on `/docs`, and MongoDB on 27017. Run `stop-dev.bat` or `./stop-dev.sh` to shut everything down.

## Features

The seven feature guides are the deep reference for everything you can do in APIWeave. Each is a self-contained tutorial with worked examples and a troubleshooting section.

- [Workflows and Nodes](docs/features/workflows-and-nodes.md): canvas, the six node types, toolbar actions, resume after a failed run.
- [Variables and Extractors](docs/features/variables-and-extractors.md): the four placeholder namespaces and how to pull values from responses.
- [Environments and Secrets](docs/features/environments-and-secrets.md): dev/stage/prod variables, secret keys, and the parts of secret resolution that are and are not wired in 1.0.
- [Collections](docs/features/collections.md): group workflows, ordered execution, `.awecollection` export and import.
- [Webhooks](docs/features/webhooks.md): trigger runs from CI/CD with token and HMAC auth.
- [MCP Integration](docs/features/mcp-integration.md): drive APIWeave from AI coding agents over the Model Context Protocol.
- [Swagger and OpenAPI Import](docs/features/swagger-import.md): turn a spec into reusable request templates.

## Documentation

The [Documentation Hub](docs/README.md) is the entry point for every user-facing guide. It routes you through three paths (use it, build with it, fix something) and links to the operations, reference, and feature indexes. Start there for install paths, the first-workflow tutorial, and the central FAQ.

## Tech Stack

- Frontend: React 18, ReactFlow 11, Vite 5, Tailwind CSS 3, Zustand 5.
- Backend: Python 3.13, FastAPI, Beanie ODM on MongoDB 7 (via Motor).
- Execution: an in-process `WorkflowExecutor` plus an optional separate worker for horizontal scale.
- Reporting: JUnit XML and HTML run artifacts.

## Project Layout

```text
apiweave/
  backend/   FastAPI API, Beanie models, repositories, worker, MCP server
  frontend/  React app, ReactFlow canvas, contexts, components
  docs/      User-facing documentation (the hub and all guides)
  progress/  Internal implementation notes and history
```

## License

MIT. See [LICENSE](LICENSE).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, branching, commit style, and the pull-request flow.

## Roadmap

See [ROADMAP.md](ROADMAP.md) for the 1.1 and beyond plan. For historical releases, see [CHANGELOG.md](CHANGELOG.md).
