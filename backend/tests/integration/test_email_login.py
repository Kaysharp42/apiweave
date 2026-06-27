"""Passwordless email magic-link sign-in (Phase 3 — email login).

Covers the eligibility policy (REGISTRATION_MODE + approved-domains) and the
single-use/TTL token lifecycle. SMTP is off in tests, so request_login_link
just creates the token (and logs the link); verify is tested directly.
"""

from __future__ import annotations

import hashlib
from datetime import UTC, datetime, timedelta

import pytest
from app.config import settings
from app.models import EmailAuthToken
from app.repositories.email_auth_repository import EmailAuthTokenRepository
from app.repositories.workspace_repository import WorkspaceRepository
from app.services import email_auth_service as svc
from fastapi import HTTPException

_ALICE = "alice@example.com"  # seeded user


@pytest.fixture(autouse=True)
def _no_general_invites(monkeypatch):
    # InviteRepository.find_active_by_email uses a $expr/$toLower query mongomock
    # can't aggregate (works in real Mongo). These tests don't use general
    # invites, so stub it to None.
    from app.repositories.auth_repositories import InviteRepository

    async def _none(_email: str):
        return None

    monkeypatch.setattr(InviteRepository, "find_active_by_email", _none)


def _hash(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


async def _make_token(
    email: str, *, raw: str = "rawtok", consumed: bool = False, ttl_min: int = 15
) -> str:
    now = datetime.now(UTC)
    await EmailAuthTokenRepository.create(
        token_id="eat-test",
        token_hash=_hash(raw),
        email=email,
        created_at=now,
        expires_at=now + timedelta(minutes=ttl_min),
    )
    if consumed:
        await EmailAuthTokenRepository.consume("eat-test")
    return raw


async def _token_for(email: str) -> EmailAuthToken | None:
    return await EmailAuthToken.find_one(EmailAuthToken.email == email)


# --- request eligibility policy ---


async def test_request_creates_token_for_existing_user(seeded) -> None:
    await svc.request_login_link(_ALICE)
    assert await _token_for(_ALICE) is not None


async def test_request_no_token_for_unknown_invite_only(seeded, monkeypatch) -> None:
    monkeypatch.setattr(settings, "REGISTRATION_MODE", "invite_only")
    await svc.request_login_link("stranger@example.com")
    assert await _token_for("stranger@example.com") is None


async def test_request_creates_token_open_mode(seeded, monkeypatch) -> None:
    monkeypatch.setattr(settings, "REGISTRATION_MODE", "open")
    await svc.request_login_link("newbie@example.com")
    assert await _token_for("newbie@example.com") is not None


async def test_request_blocked_by_approved_domains(seeded, monkeypatch) -> None:
    monkeypatch.setattr(settings, "REGISTRATION_MODE", "open")
    monkeypatch.setattr(settings, "APPROVED_DOMAINS_ENABLED", True)
    monkeypatch.setattr(settings, "APPROVED_DOMAINS", "corp.example")
    await svc.request_login_link("outsider@other.example")
    assert await _token_for("outsider@other.example") is None


# --- verify lifecycle ---


async def test_verify_existing_user_consumes_token(seeded) -> None:
    raw = await _make_token(_ALICE)
    user = await svc.verify_login_token(raw)
    assert user.userId == "alice"
    tok = await _token_for(_ALICE)
    assert tok is not None and tok.consumed


async def test_verify_rejects_expired(seeded) -> None:
    raw = await _make_token(_ALICE, ttl_min=-1)
    with pytest.raises(HTTPException) as exc:
        await svc.verify_login_token(raw)
    assert exc.value.status_code == 400


async def test_verify_rejects_already_consumed(seeded) -> None:
    raw = await _make_token(_ALICE, consumed=True)
    with pytest.raises(HTTPException) as exc:
        await svc.verify_login_token(raw)
    assert exc.value.status_code == 400


async def test_verify_creates_user_in_open_mode(seeded, monkeypatch) -> None:
    monkeypatch.setattr(settings, "REGISTRATION_MODE", "open")
    raw = await _make_token("fresh@example.com")
    user = await svc.verify_login_token(raw)
    assert user.verified_email == "fresh@example.com"
    # A personal workspace is bootstrapped, like the OAuth path.
    assert await WorkspaceRepository.get_personal_for_user(user.userId) is not None


async def test_verify_rejects_unknown_in_invite_only(seeded, monkeypatch) -> None:
    monkeypatch.setattr(settings, "REGISTRATION_MODE", "invite_only")
    raw = await _make_token("nobody@example.com")
    with pytest.raises(HTTPException) as exc:
        await svc.verify_login_token(raw)
    assert exc.value.status_code == 403


async def test_verify_auto_accepts_org_invite(seeded, monkeypatch) -> None:
    # org invite = magic link: an invited email is eligible even in invite_only,
    # and clicking the link signs them in AND joins the org.
    monkeypatch.setattr(settings, "REGISTRATION_MODE", "invite_only")
    from datetime import timedelta

    from app.models import Organization, OrgInvite
    from app.repositories.org_invite_repository import OrgInviteRepository
    from app.repositories.organization_repository import OrganizationRepository

    future = datetime.now(UTC) + timedelta(days=7)
    await Organization(
        orgId="org-x",
        slug="org-x",
        name="Org X",
        ownerUserId="founder",
        createdAt=datetime.now(UTC),
        updatedAt=datetime.now(UTC),
    ).insert()
    await OrgInvite(
        inviteId="oi-x",
        orgId="org-x",
        email="invitee@example.com",
        token_hash="h",
        role="member",
        invited_by="founder",
        created_at=datetime.now(UTC),
        expires_at=future,
        consumed=False,
    ).insert()

    raw = await _make_token("invitee@example.com")
    user = await svc.verify_login_token(raw)

    member = await OrganizationRepository.get_member("org-x", user.userId)
    assert member is not None and member.role == "member"
    invite = await OrgInviteRepository.get_by_id("oi-x")
    assert invite is not None and invite.consumed


# --- route gating ---


async def _request(email: str):
    from app.main import app
    from httpx import ASGITransport, AsyncClient

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        return await ac.post("/api/auth/email/request", json={"email": email})


async def test_request_route_404_when_disabled(seeded, monkeypatch) -> None:
    monkeypatch.setattr(settings, "EMAIL_LOGIN_ENABLED", False)
    resp = await _request(_ALICE)
    assert resp.status_code == 404


async def test_request_route_200_no_enumeration(seeded, monkeypatch) -> None:
    monkeypatch.setattr(settings, "EMAIL_LOGIN_ENABLED", True)
    # Unknown email in invite_only still returns 200 (no account-existence leak).
    monkeypatch.setattr(settings, "REGISTRATION_MODE", "invite_only")
    resp = await _request("ghost@example.com")
    assert resp.status_code == 200
    assert await _token_for("ghost@example.com") is None  # but no link was issued
