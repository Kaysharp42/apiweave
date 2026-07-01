"""P4.1: plan resolver + entitlement gates with BILLING_ENABLED on.

(test_entitlements.py covers the billing-off allow-all path.)
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import pytest
from app.billing import plans
from app.billing.entitlement_resolver import resolve_plan
from app.config import settings
from app.models import (
    OrganizationMember,
    RateLimitCounter,
    Run,
    Subscription,
    WebhookLog,
    Workspace,
)
from app.services import entitlements
from beanie import init_beanie
from fastapi import HTTPException
from mongomock_motor import AsyncMongoMockClient

_T = datetime(2026, 6, 29, tzinfo=UTC)


@pytest.fixture
async def billing_db(monkeypatch):
    monkeypatch.setattr(settings, "BILLING_ENABLED", True)
    client = AsyncMongoMockClient()
    await init_beanie(
        database=client["billing_test"],
        document_models=[
            Subscription,
            OrganizationMember,
            Workspace,
            Run,
            RateLimitCounter,
            WebhookLog,
        ],
    )


async def _sub(owner_type: str, owner_id: str, plan: str) -> None:
    await Subscription(
        subscriptionId=f"sub-{owner_id}",
        ownerType=owner_type,
        ownerId=owner_id,
        plan=plan,
        status="active",
        seats=plans.PLAN_BY_KEY[plan].max_seats or 0,
        createdAt=_T,
        updatedAt=_T,
    ).insert()


def _user(uid: str):
    return SimpleNamespace(userId=uid)


async def test_resolver_defaults_to_free_then_reads_subscription(billing_db):
    assert (await resolve_plan("user", "u-none")).key == "free"
    await _sub("user", "u-team", "team")
    assert (await resolve_plan("user", "u-team")).key == "team"


async def test_free_user_cannot_create_org_team_user_can(billing_db):
    with pytest.raises(HTTPException) as exc:
        await entitlements.require_can_create_org(_user("u-free"))
    assert exc.value.status_code == 402

    await _sub("user", "u-team", "team")
    await entitlements.require_can_create_org(_user("u-team"))  # no raise


async def test_personal_workspace_always_allowed_org_workspace_gated(billing_db):
    # Personal workspace: allowed even with no subscription.
    await entitlements.require_can_create_workspace(actor_user_id="u-free", org_id=None)
    # Org-owned workspace under a sub-less org: denied.
    with pytest.raises(HTTPException):
        await entitlements.require_can_create_workspace(actor_user_id="u-x", org_id="org-free")
    # Under a Team org: allowed.
    await _sub("organization", "org-team", "team")
    await entitlements.require_can_create_workspace(actor_user_id="u-x", org_id="org-team")


async def _ws(workspace_id: str, owner_user_id: str) -> None:
    await Workspace(
        workspaceId=workspace_id,
        slug=workspace_id,
        name=workspace_id,
        ownerType="user",
        ownerUserId=owner_user_id,
        isPersonal=True,
        createdAt=_T,
        updatedAt=_T,
    ).insert()


async def test_project_and_rerun_gated_by_workspace_owner_plan(billing_db):
    await _ws("ws-free", "u-free")
    with pytest.raises(HTTPException):
        await entitlements.require_can_create_project("ws-free")
    with pytest.raises(HTTPException):
        await entitlements.require_can_rerun_from_failed("ws-free")

    await _sub("user", "u-paid", "individual")
    await _ws("ws-paid", "u-paid")
    await entitlements.require_can_create_project("ws-paid")  # no raise
    await entitlements.require_can_rerun_from_failed("ws-paid")  # no raise


async def _runs(workflow_id: str, n: int) -> None:
    for i in range(n):
        await Run(
            runId=f"{workflow_id}-r{i}",
            workflowId=workflow_id,
            status="completed",
            trigger="manual",
            createdAt=_T + timedelta(minutes=i),
        ).insert()


async def test_run_history_retention_free_keeps_one_paid_keeps_all(billing_db):
    await _ws("ws-free", "u-free")
    await _runs("wf-free", 3)
    await entitlements.enforce_run_history_retention("ws-free", "wf-free")
    assert await Run.find(Run.workflowId == "wf-free").count() == 1

    await _sub("user", "u-paid", "individual")
    await _ws("ws-paid", "u-paid")
    await _runs("wf-paid", 3)
    await entitlements.enforce_run_history_retention("ws-paid", "wf-paid")
    assert await Run.find(Run.workflowId == "wf-paid").count() == 3


async def _log(log_id: str) -> None:
    await WebhookLog(
        logId=log_id,
        webhookId="wh-1",
        timestamp=_T,
        status="success",
        duration=1,
        responseStatus=202,
    ).insert()


async def test_webhook_log_retention_free_deletes_paid_keeps(billing_db):
    await _ws("ws-free", "u-free")
    await _log("log-free")
    await entitlements.enforce_webhook_log_retention("ws-free", "log-free")
    assert await WebhookLog.find(WebhookLog.logId == "log-free").count() == 0

    await _sub("user", "u-paid", "individual")
    await _ws("ws-paid", "u-paid")
    await _log("log-paid")
    await entitlements.enforce_webhook_log_retention("ws-paid", "log-paid")
    assert await WebhookLog.find(WebhookLog.logId == "log-paid").count() == 1


async def test_webhook_daily_quota_enforced(billing_db):
    await _ws("ws-free", "u-free")  # free plan -> 5 webhook runs/day
    for _ in range(5):
        await entitlements.require_webhook_run_allowed("ws-free")  # no raise
    with pytest.raises(HTTPException) as exc:
        await entitlements.require_webhook_run_allowed("ws-free")
    assert exc.value.status_code == 402

    # The /usage meter must read the same counter (key/window must not drift).
    assert await entitlements.webhook_runs_today("user", "u-free") >= 5


async def test_seat_limit_enforced(billing_db):
    # Free-plan org (max 1 seat) with one member already → next add denied.
    await _sub("organization", "org-solo", "free")
    await OrganizationMember(
        memberId="m1", orgId="org-solo", userId="u1", role="owner", createdAt=_T, updatedAt=_T
    ).insert()
    with pytest.raises(HTTPException) as exc:
        await entitlements.require_can_add_org_member("org-solo")
    assert exc.value.status_code == 402

    # Team org (100 seats) with one member → allowed.
    await _sub("organization", "org-big", "team")
    await OrganizationMember(
        memberId="m2", orgId="org-big", userId="u2", role="owner", createdAt=_T, updatedAt=_T
    ).insert()
    await entitlements.require_can_add_org_member("org-big")  # no raise
