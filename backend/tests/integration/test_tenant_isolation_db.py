"""DB-backed cross-tenant isolation against the REAL app (roadmap §4 / P1.6/P1.7).

Bob is a member of nothing; Alice owns ws-alice. Drives the actual FastAPI app
(real routes, real services, real Beanie) so workspaces.py service-layer checks
execute against real membership data — the proof the router-only unit matrix
can't give.
"""

from __future__ import annotations

import pytest
from app.auth.dependencies import get_current_active_user, get_current_user
from app.main import app
from httpx import ASGITransport, AsyncClient


def _act_as(user) -> None:
    app.dependency_overrides[get_current_user] = lambda: user
    app.dependency_overrides[get_current_active_user] = lambda: user


@pytest.fixture(autouse=True)
def _clear_overrides():
    yield
    app.dependency_overrides.clear()


async def _get(url: str):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        return await ac.get(url)


async def test_bob_cannot_list_alice_secrets(seeded) -> None:
    _act_as(seeded.bob)
    resp = await _get(f"/api/scopes/workspace/{seeded.workspace_id}/secrets")
    assert resp.status_code == 404


async def test_bob_cannot_read_alice_run(seeded) -> None:
    _act_as(seeded.bob)
    resp = await _get(f"/api/runs/{seeded.run_id}")
    assert resp.status_code == 404


async def test_alice_can_list_her_secrets(seeded) -> None:
    _act_as(seeded.alice)
    resp = await _get(f"/api/scopes/workspace/{seeded.workspace_id}/secrets")
    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] == 1
    assert body["secrets"][0]["name"] == "API_KEY"


async def test_alice_can_read_her_run(seeded) -> None:
    _act_as(seeded.alice)
    resp = await _get(f"/api/runs/{seeded.run_id}")
    assert resp.status_code == 200
    assert resp.json()["runId"] == seeded.run_id


async def test_bob_cannot_access_alice_workspace(seeded) -> None:
    # Exercises workspaces.py service-layer isolation (_assert_workspace_access).
    _act_as(seeded.bob)
    resp = await _get(f"/api/workspaces/{seeded.workspace_id}")
    assert resp.status_code in (403, 404)


async def test_bob_cannot_list_alice_workspace_workflows(seeded) -> None:
    _act_as(seeded.bob)
    resp = await _get(f"/api/workspaces/{seeded.workspace_id}/workflows")
    assert resp.status_code in (403, 404)


async def test_alice_can_access_her_workspace(seeded) -> None:
    _act_as(seeded.alice)
    resp = await _get(f"/api/workspaces/{seeded.workspace_id}")
    assert resp.status_code == 200


async def test_single_user_owner_boots_and_accesses_workspace(
    seeded, monkeypatch: pytest.MonkeyPatch
) -> None:
    """End-to-end §1.4: in single_user mode the synthetic owner is bootstrapped
    and authorized against the REAL app with no override, no login."""
    from app.auth import single_user
    from app.config import settings
    from app.repositories.workspace_repository import WorkspaceRepository

    single_user.invalidate_cache()
    monkeypatch.setattr(settings, "DEPLOYMENT_MODE", "single_user")
    try:
        # First access bootstraps the owner + its personal workspace in the test DB.
        owner = await single_user.get_or_create_implicit_owner()
        personal = await WorkspaceRepository.get_personal_for_user(owner.userId)
        assert personal is not None

        # No dependency override: the real single_user auth path resolves the owner.
        app.dependency_overrides.clear()
        resp = await _get(f"/api/workspaces/{personal.workspaceId}")
        assert resp.status_code == 200
    finally:
        single_user.invalidate_cache()
