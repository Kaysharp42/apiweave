"""
Tests for SSRF protection in OpenAPI import paths (Task 8).

Verifies that fetch_openapi_from_url (service layer) and the
import_openapi_from_url route (workflows.py) block requests to
private/internal URLs before any outbound HTTP is made.
"""

from __future__ import annotations

import hashlib
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, patch

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.auth.permissions import WORKFLOWS_IMPORT
from app.models import Session, User
from app.repositories.auth_repositories import SessionRepository, UserRepository
from app.routes._legacy_disabled import workflows


def _make_session(
    token: str = "test-session-token",
    user_id: str = "user-1",
) -> tuple[Session, str]:
    now = datetime.now(UTC)
    return (
        Session.model_construct(
            sessionId=f"ses-{user_id}",
            userId=user_id,
            token_hash=hashlib.sha256(token.encode()).hexdigest(),
            created_at=now,
            last_seen_at=now,
            expires_at=now + timedelta(days=7),
            revoked=False,
        ),
        token,
    )


def _make_user(
    user_id: str = "user-1",
    permissions: list[str] | None = None,
) -> User:
    now = datetime.now(UTC)
    return User.model_construct(
        userId=user_id,
        verified_email=f"{user_id}@example.com",
        display_name="Test User",
        avatar_url=None,
        roles=[],
        permissions=permissions or [WORKFLOWS_IMPORT],
        is_setup_complete=True,
        created_at=now,
        updated_at=now,
    )


def _route_client() -> TestClient:
    app = FastAPI()
    app.include_router(workflows.router)
    return TestClient(app)


def _authenticated_client() -> tuple[TestClient, str]:
    client = _route_client()
    token = "test-session-token"
    client.cookies.set("session", token)
    return client, token


def _patch_auth(user: User | None = None, token: str = "test-session-token"):
    user = user or _make_user()
    session, _ = _make_session(token=token, user_id=user.userId)
    return (
        patch.object(SessionRepository, "get_by_token_hash", new=AsyncMock(return_value=session)),
        patch.object(SessionRepository, "touch", new=AsyncMock(return_value=True)),
        patch.object(UserRepository, "get_by_id", new=AsyncMock(return_value=user)),
    )


class TestFetchOpenapiFromUrlBlocksPrivateIPs:
    """Service-layer fetch_openapi_from_url must reject private/internal URLs."""

    @pytest.mark.asyncio
    async def test_blocks_loopback(self):
        from app.services.import_service import fetch_openapi_from_url

        with pytest.raises(ValueError, match="URL blocked"):
            await fetch_openapi_from_url("http://127.0.0.1:8000/health")

    @pytest.mark.asyncio
    async def test_blocks_cloud_metadata(self):
        from app.services.import_service import fetch_openapi_from_url

        with pytest.raises(ValueError, match="URL blocked"):
            await fetch_openapi_from_url("http://169.254.169.254/")

    @pytest.mark.asyncio
    async def test_blocks_private_10_net(self):
        from app.services.import_service import fetch_openapi_from_url

        with pytest.raises(ValueError, match="URL blocked"):
            await fetch_openapi_from_url("http://10.0.0.1/openapi.json")

    @pytest.mark.asyncio
    async def test_blocks_ipv6_loopback(self):
        from app.services.import_service import fetch_openapi_from_url

        with pytest.raises(ValueError, match="URL blocked"):
            await fetch_openapi_from_url("http://[::1]:8000/spec")


@pytest.mark.asyncio
async def test_fetch_openapi_from_webjars_localhost_uses_primary_definition():
    from app.services.import_service import fetch_openapi_from_url

    swagger_html = "<html><body>Swagger UI</body></html>"
    config = {
        "urls.primaryName": "Actor Service",
        "urls": [
            {"name": "Actor Service", "url": "/swagger/actors/v3/api-docs"},
            {"name": "Asset Service", "url": "/swagger/assets/v3/api-docs"},
        ],
    }
    actor_spec = {
        "openapi": "3.1.0",
        "info": {"title": "Actor Service API", "version": "1.0"},
        "paths": {
            "/actors": {
                "get": {
                    "summary": "List actors",
                    "responses": {"200": {"description": "OK"}},
                }
            }
        },
    }

    async def handler(request: httpx.Request) -> httpx.Response:
        if request.url.host == "localhost":
            raise httpx.ConnectError("All connection attempts failed", request=request)
        if request.url.path == "/webjars/swagger-ui/index.html":
            return httpx.Response(200, text=swagger_html, headers={"content-type": "text/html"})
        if request.url.path == "/v3/api-docs/swagger-config":
            return httpx.Response(200, json=config)
        if request.url.path == "/swagger/actors/v3/api-docs":
            return httpx.Response(200, json=actor_spec)
        return httpx.Response(404, json={"detail": "not found"})

    class MockedAsyncClient(httpx.AsyncClient):
        def __init__(self, *args, **kwargs):
            kwargs["transport"] = httpx.MockTransport(handler)
            super().__init__(*args, **kwargs)

    with patch("httpx.AsyncClient", MockedAsyncClient):
        result = await fetch_openapi_from_url(
            "http://localhost:8800/webjars/swagger-ui/index.html"
            "?urls.primaryName=Actor+Service"
        )

    assert result["total_endpoints"] == 1
    assert result["api_title"] == "Actor Service API"
    assert len(result["definitions"]) == 1
    assert result["definitions"][0]["name"] == "Actor Service"
    assert result["nodes"][0]["config"]["url"] == "/actors"


class TestImportOpenapiFromUrlRouteBlocksPrivateIPs:
    """Route-layer import_openapi_from_url must return 400 for private URLs."""

    def test_route_blocks_loopback_url(self):
        client, token = _authenticated_client()
        session_p, touch_p, user_p = _patch_auth(token=token)

        with session_p, touch_p, user_p:
            response = client.get(
                "/api/workflows/import/openapi/url",
                params={"swagger_url": "http://127.0.0.1:9876/openapi.json"},
            )

        assert response.status_code == 400
        assert "blocked" in response.json()["detail"].lower()

    def test_route_blocks_metadata_url(self):
        client, token = _authenticated_client()
        session_p, touch_p, user_p = _patch_auth(token=token)

        with session_p, touch_p, user_p:
            response = client.get(
                "/api/workflows/import/openapi/url",
                params={"swagger_url": "http://169.254.169.254/latest/meta-data/"},
            )

        assert response.status_code == 400
        assert "blocked" in response.json()["detail"].lower()

    def test_unauthenticated_request_rejected(self):
        client = _route_client()
        response = client.get(
            "/api/workflows/import/openapi/url",
            params={"swagger_url": "http://127.0.0.1:9876/openapi.json"},
        )
        assert response.status_code == 401
