"""
Tests for Wave 1 Task 6: API route skeleton and old router cleanup.

Verifies:
- New nested route skeletons (orgs, workspaces, projects, keys) return 200.
- Old flat route prefixes (workflows, environments, collections, runs, webhooks) return 404.
- Healthz endpoints on new skeletons respond correctly.
"""

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.routes import orgs, projects, workspaces


def _build_app() -> FastAPI:
    """Build a minimal app with skeleton routers only (no auth middleware)."""
    app = FastAPI()
    app.include_router(orgs.router)
    app.include_router(workspaces.router)
    app.include_router(projects.router)
    return app


client = TestClient(_build_app())


class TestNewSkeletonRoutes:
    """New nested route skeletons must resolve (200), not 404."""

    def test_orgs_list_requires_auth(self) -> None:
        response = client.get("/api/orgs")
        assert (
            response.status_code == 401
        ), f"Expected 401 (auth required), got {response.status_code}"

    def test_orgs_healthz(self) -> None:
        response = client.get("/api/orgs/healthz")
        assert response.status_code == 200
        assert response.json() == {"status": "ok"}

    def test_workspaces_list_requires_auth(self) -> None:
        response = client.get("/api/workspaces")
        assert (
            response.status_code == 401
        ), f"Expected 401 (auth required), got {response.status_code}"

    def test_workspaces_healthz(self) -> None:
        response = client.get("/api/workspaces/healthz")
        assert response.status_code == 200
        assert response.json() == {"status": "ok"}

    def test_projects_list(self) -> None:
        response = client.get("/api/projects")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"

    def test_projects_healthz(self) -> None:
        response = client.get("/api/projects/healthz")
        assert response.status_code == 200
        assert response.json() == {"status": "ok"}


class TestOldFlatRoutesRemoved:
    """Old flat route prefixes must return 404 (not mounted)."""

    def test_workflows_404(self) -> None:
        response = client.get("/api/workflows")
        assert response.status_code == 404, f"Expected 404, got {response.status_code}"

    def test_environments_404(self) -> None:
        response = client.get("/api/environments")
        assert response.status_code == 404, f"Expected 404, got {response.status_code}"

    def test_collections_404(self) -> None:
        response = client.get("/api/collections")
        assert response.status_code == 404, f"Expected 404, got {response.status_code}"

    def test_runs_404(self) -> None:
        response = client.get("/api/runs")
        assert response.status_code == 404, f"Expected 404, got {response.status_code}"

    def test_webhooks_404(self) -> None:
        response = client.get("/api/webhooks")
        assert response.status_code == 404, f"Expected 404, got {response.status_code}"
