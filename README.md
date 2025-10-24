# APIWeave

**Visual API Test Workflows Made Simple**

APIWeave is an open-source, visual, step-by-step API test workflow tool that allows you to create test stories using a drag-and-drop canvas. Chain API requests, perform assertions, and generate CI-friendly reports (JUnit XML + HTML) without any AI/LLM dependencies.

## Features

- 🎨 **Visual Workflow Builder** - Drag-and-drop canvas with React Flow
- 🔗 **Request Chaining** - Use data from previous steps in subsequent requests
- ✅ **Assertions** - Status codes, JSONPath matches, schema validation
- 📊 **CI-Friendly Reports** - JUnit XML and HTML reports
- 🔐 **Secrets Management** - Never persist secrets in workflows
- 🐳 **Self-Hostable** - Docker-based deployment
- 🚀 **Webhook-Driven** - Perfect for GitLab CI/CD integration

## Architecture

```
Frontend (React + React Flow) → Backend (FastAPI) → Runner (Python Worker)
                                       ↓
                                    MongoDB
```

## Quick Start

### Prerequisites

- Python 3.13+
- Node.js 20+
- MongoDB 7+ (running locally)

### Setup (One-Time)

```cmd
# Run complete setup
setup.bat
```

Or manually:

```cmd
# Backend setup
cd backend
python -m venv venv
venv\Scripts\activate
pip install -e .
copy .env.example .env

# Frontend setup
cd ..\frontend
npm install
copy .env.example .env
```

### Run Development

```cmd
# Start all services
start-dev.bat
```

This opens separate windows for:
- Backend API (http://localhost:8000)
- Worker (background jobs)
- Frontend (http://localhost:3000)

### Stop Development

```cmd
stop-dev.bat
```

## Usage

### 1. Create a Workflow in the UI

1. Open http://localhost:3000
2. Drag nodes from the palette to the canvas
3. Connect nodes to create your test flow
4. Configure each node (method, URL, assertions)
5. Save the workflow

### 2. Trigger from GitLab CI

```yaml
stages:
  - deploy
  - test

deploy_dev:
  stage: deploy
  script:
    - deploy_to_dev.sh

trigger_tests:
  stage: test
  script:
    - |
      curl -X POST "https://apiweave.company.com/api/runs/trigger" \
        -H "Authorization: Bearer ${APIWEAVE_API_KEY}" \
        -H "Content-Type: application/json" \
        -d '{
          "workflowId": "smoke-test",
          "environment": {"API_BASE_URL": "https://dev.company.com"}
        }'
```

### 3. View Reports

- Access run history in the UI
- Download JUnit XML: `GET /api/runs/{runId}/artifacts/junit.xml`
- Download HTML report: `GET /api/runs/{runId}/artifacts/report.html`

## API Reference

See [API Documentation](docs/API.md) for detailed endpoint reference.

## Example Workflows

Check out the [workflows/](workflows/) directory for example test scenarios:

- `smoke-test.json` - Basic health check and login
- `user-lifecycle.json` - CRUD operations
- `api-chain.json` - Multiple dependent requests

## Documentation

- [Installation Guide](docs/INSTALLATION.md)
- [Workflow Schema](docs/WORKFLOW_SCHEMA.md)
- [GitLab CI Integration](docs/GITLAB_CI.md)
- [API Reference](docs/API.md)

## Project Structure

```
apiweave/
├── frontend/          # React UI
├── backend/           # FastAPI backend
├── shared/            # Shared schemas
├── workflows/         # Example workflows
├── docs/              # Documentation
└── docker-compose.yml # Local dev environment
```

## Contributing

Contributions are welcome! Please read [CONTRIBUTING.md](CONTRIBUTING.md) for details.

## License

MIT License - see [LICENSE](LICENSE) for details.

## Roadmap

- [x] v0.1 - MVP (Sequential workflows, basic nodes, webhook triggers)
- [ ] v0.2 - Parallel execution, OAuth helpers, retries
- [ ] v0.3 - OpenAPI validation, dataset-driven runs
- [ ] v0.4 - Plugin SDK, vault integration
- [ ] v1.0 - Team workspaces, RBAC, audit logs

## Support

- 📖 [Documentation](docs/)
- 💬 [Discussions](https://github.com/yourusername/apiweave/discussions)
- 🐛 [Issues](https://github.com/yourusername/apiweave/issues)

---

Built with ❤️ by Ahmed KHIARI
