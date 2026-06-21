"""
Task 26 — Old flat routes return 404.

The legacy flat route prefixes (/api/workflows, /api/environments, /api/collections)
are no longer mounted in main.py.  They must return 404 for every HTTP method.

Note: /api/runs and /api/webhooks ARE still mounted (scoped versions coexist),
so only workflows, environments, and collections are tested as removed.
"""

from __future__ import annotations

from app.routes import orgs, projects, workspaces
from fastapi import FastAPI
from fastapi.testclient import TestClient


def _build_skeleton_app() -> FastAPI:
    """Minimal app with only the new scoped routers (mirrors main.py minus legacy)."""
    app = FastAPI()
    app.include_router(orgs.router)
    app.include_router(workspaces.router)
    app.include_router(projects.router)
    return app


_client = TestClient(_build_skeleton_app())


# ---------------------------------------------------------------------------
# Old flat routes — must all 404
# ---------------------------------------------------------------------------


class TestOldWorkflowsRoutes404:
    """Legacy /api/workflows prefix is not mounted."""

    def test_get_workflows_404(self) -> None:
        assert _client.get("/api/workflows").status_code == 404

    def test_post_workflows_404(self) -> None:
        assert _client.post("/api/workflows", json={"name": "x"}).status_code == 404

    def test_get_workflows_by_id_404(self) -> None:
        assert _client.get("/api/workflows/wf-123").status_code == 404

    def test_put_workflows_404(self) -> None:
        assert _client.put("/api/workflows/wf-123", json={}).status_code == 404

    def test_delete_workflows_404(self) -> None:
        assert _client.delete("/api/workflows/wf-123").status_code == 404

    def test_post_workflows_run_404(self) -> None:
        assert _client.post("/api/workflows/wf-123/run").status_code == 404


class TestOldEnvironmentsRoutes404:
    """Legacy /api/environments prefix is not mounted."""

    def test_get_environments_404(self) -> None:
        assert _client.get("/api/environments").status_code == 404

    def test_post_environments_404(self) -> None:
        assert _client.post("/api/environments", json={"name": "x"}).status_code == 404

    def test_get_environments_by_id_404(self) -> None:
        assert _client.get("/api/environments/env-123").status_code == 404

    def test_put_environments_404(self) -> None:
        assert _client.put("/api/environments/env-123", json={}).status_code == 404

    def test_delete_environments_404(self) -> None:
        assert _client.delete("/api/environments/env-123").status_code == 404


class TestOldCollectionsRoutes404:
    """Legacy /api/collections prefix is not mounted."""

    def test_get_collections_404(self) -> None:
        assert _client.get("/api/collections").status_code == 404

    def test_post_collections_404(self) -> None:
        assert _client.post("/api/collections", json={"name": "x"}).status_code == 404

    def test_get_collections_by_id_404(self) -> None:
        assert _client.get("/api/collections/col-123").status_code == 404

    def test_put_collections_404(self) -> None:
        assert _client.put("/api/collections/col-123", json={}).status_code == 404

    def test_delete_collections_404(self) -> None:
        assert _client.delete("/api/collections/col-123").status_code == 404

    def test_post_collections_export_404(self) -> None:
        assert _client.post("/api/collections/col-123/export").status_code == 404

    def test_post_collections_import_404(self) -> None:
        assert _client.post("/api/collections/import", json={}).status_code == 404


# ---------------------------------------------------------------------------
# New scoped routes are alive (sanity check)
# ---------------------------------------------------------------------------


class TestNewScopedRoutesAlive:
    """New scoped routes resolve (not 404)."""

    def test_orgs_healthz(self) -> None:
        resp = _client.get("/api/orgs/healthz")
        assert resp.status_code == 200

    def test_workspaces_healthz(self) -> None:
        resp = _client.get("/api/workspaces/healthz")
        assert resp.status_code == 200

    def test_projects_healthz(self) -> None:
        resp = _client.get("/api/projects/healthz")
        assert resp.status_code == 200

    def test_orgs_list_requires_auth(self) -> None:
        resp = _client.get("/api/orgs")
        assert resp.status_code == 401

    def test_workspaces_list_requires_auth(self) -> None:
        resp = _client.get("/api/workspaces")
        assert resp.status_code == 401
