"""DB-backed integration harness: real app + in-memory Beanie (mongomock-motor).

Seeds two tenants (Alice, Bob) so cross-tenant isolation can be proven against
the REAL FastAPI app and the REAL service layer — including workspaces.py's
_assert_workspace_access (roadmap P1.6/P1.7), which the router-only unit tests
cannot reach.

Endpoints are driven via httpx ASGITransport on the SAME event loop as Beanie
init (TestClient uses a separate portal loop, which motor/Beanie dislike).
"""

from __future__ import annotations

from datetime import UTC, datetime
from types import SimpleNamespace

import mongomock
import pytest
from beanie import init_beanie
from mongomock_motor import AsyncMongoMockClient

# Beanie calls list_collection_names(authorizedCollections=..., nameOnly=...);
# mongomock's signature rejects those kwargs. Swallow extras (test-only shim).
_orig_list_collection_names = mongomock.database.Database.list_collection_names


def _list_collection_names(self, *args, **kwargs):  # noqa: ANN001, ANN202
    return _orig_list_collection_names(self)


mongomock.database.Database.list_collection_names = _list_collection_names

from app.models import (
    ApprovedDomain,
    AuditEvent,
    CollectionRun,
    DeletedUser,
    Environment,
    EnvironmentProtection,
    IdempotencyKey,
    Invite,
    OAuthState,
    Organization,
    OrganizationMember,
    OrgInvite,
    OutsideCollaborator,
    PendingRunApproval,
    Project,
    ProviderIdentity,
    Run,
    ScopedKeypair,
    Secret,
    SecretBinding,
    ServiceToken,
    Session,
    Team,
    TeamMember,
    TeamPermissionGrant,
    User,
    Webhook,
    WebhookLog,
    Workflow,
    Workspace,
    WorkspaceMember,
)

_DOCUMENT_MODELS = [
    Workflow,
    Run,
    Environment,
    Project,
    Webhook,
    CollectionRun,
    WebhookLog,
    IdempotencyKey,
    User,
    DeletedUser,
    ProviderIdentity,
    Session,
    Invite,
    ApprovedDomain,
    OAuthState,
    AuditEvent,
    ScopedKeypair,
    Secret,
    SecretBinding,
    Organization,
    OrganizationMember,
    Team,
    TeamMember,
    Workspace,
    WorkspaceMember,
    OutsideCollaborator,
    EnvironmentProtection,
    ServiceToken,
    OrgInvite,
    TeamPermissionGrant,
    PendingRunApproval,
]

_T = datetime(2026, 6, 26, tzinfo=UTC)


@pytest.fixture
async def seeded():
    """Init in-memory Beanie and seed Alice's tenant + a non-member Bob."""
    client = AsyncMongoMockClient()
    await init_beanie(database=client["isolation_test"], document_models=_DOCUMENT_MODELS)

    alice = User(
        userId="alice",
        verified_email="alice@example.com",
        roles=[],
        permissions=[],
        created_at=_T,
        updated_at=_T,
    )
    bob = User(
        userId="bob",
        verified_email="bob@example.com",
        roles=[],
        permissions=[],
        created_at=_T,
        updated_at=_T,
    )
    await alice.insert()
    await bob.insert()

    ws = Workspace(
        workspaceId="ws-alice",
        slug="alice",
        name="Alice WS",
        ownerType="user",
        ownerUserId="alice",
        createdAt=_T,
        updatedAt=_T,
    )
    await ws.insert()
    await WorkspaceMember(
        memberId="m-alice",
        workspaceId="ws-alice",
        userId="alice",
        role="admin",
        createdAt=_T,
        updatedAt=_T,
    ).insert()

    await Secret(
        secretId="sec-1",
        name="API_KEY",
        scopeType="workspace",
        scopeId="ws-alice",
        ciphertext="x",
        keyId="kp-1",
        createdAt=_T,
        updatedAt=_T,
    ).insert()

    await Run(
        runId="run-alice",
        workflowId="wf-alice",
        status="completed",
        trigger="manual",
        workspaceId="ws-alice",
        createdAt=_T,
    ).insert()

    yield SimpleNamespace(alice=alice, bob=bob, workspace_id="ws-alice", run_id="run-alice")
