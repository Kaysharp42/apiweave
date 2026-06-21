"""Service-level tests for invite_service.

Covers:
1. Token generation (≥32 bytes URL-safe)
2. 7-day expiry
3. Consume marks consumed; second consume returns None
4. Expired invite rejected on consume
5. send_invite_email returns False when SMTP not configured
6. send_invite_email calls aiosmtplib.send when SMTP configured
7. validate_invite_token returns invite without consuming
"""

from __future__ import annotations

import base64
import hashlib
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.models import Invite
from app.repositories.auth_repositories import (
    DeletedUserRepository,
    InviteRepository,
    UserRepository,
)
from app.services import invite_service


def _make_invite(
    invite_id: str = "inv-test1",
    email: str = "new@example.com",
    consumed: bool = False,
    expires_at: datetime | None = None,
    token: str = "rawtoken",
) -> Invite:
    now = datetime.now(UTC)
    return Invite.model_construct(
        inviteId=invite_id,
        email=email,
        token_hash=hashlib.sha256(token.encode("utf-8")).hexdigest(),
        role_preset="viewer",
        created_by="admin-1",
        created_at=now,
        expires_at=expires_at or (now + timedelta(days=7)),
        consumed=consumed,
        consumed_at=now if consumed else None,
        invite_url=f"http://localhost:3000/invite/{token}",
    )


@pytest.mark.asyncio
async def test_create_invite_generates_secure_token() -> None:
    raw_token: str | None = None

    async def fake_create(**kwargs: object) -> Invite:
        nonlocal raw_token
        return _make_invite(invite_id="inv-gen")

    with (
        patch.object(InviteRepository, "find_active_by_email", new=AsyncMock(return_value=None)),
        patch.object(UserRepository, "get_by_email", new=AsyncMock(return_value=None)),
        patch.object(InviteRepository, "create", new=AsyncMock(side_effect=fake_create)),
        patch.object(DeletedUserRepository, "delete_by_email", new=AsyncMock(return_value=True)),
    ):
        _, raw_token, _ = await invite_service.create_invite(
            email="test@example.com",
            role_preset="viewer",
            invited_by="admin-1",
        )

    assert raw_token is not None
    decoded = base64.urlsafe_b64decode(raw_token + "==")
    assert len(decoded) >= 32


@pytest.mark.asyncio
async def test_create_invite_sets_7day_expiry() -> None:
    captured_expires: datetime | None = None

    async def capture_create(**kwargs: object) -> Invite:
        nonlocal captured_expires
        captured_expires = kwargs["expires_at"]  # type: ignore[assignment]
        return _make_invite()

    before = datetime.now(UTC)
    with (
        patch.object(InviteRepository, "find_active_by_email", new=AsyncMock(return_value=None)),
        patch.object(UserRepository, "get_by_email", new=AsyncMock(return_value=None)),
        patch.object(InviteRepository, "create", new=AsyncMock(side_effect=capture_create)),
        patch.object(DeletedUserRepository, "delete_by_email", new=AsyncMock(return_value=True)),
    ):
        await invite_service.create_invite(
            email="exp@example.com",
            role_preset="viewer",
            invited_by="admin-1",
        )

    assert captured_expires is not None
    delta = captured_expires - before
    assert 6.99 < delta.total_seconds() / 86400 < 7.01


@pytest.mark.asyncio
async def test_consume_invite_marks_consumed() -> None:
    invite = _make_invite(consumed=False)
    token = "rawtoken"

    with (
        patch.object(InviteRepository, "get_by_token_hash", new=AsyncMock(return_value=invite)),
        patch.object(InviteRepository, "consume", new=AsyncMock(return_value=True)),
    ):
        result_first = await invite_service.consume_invite(token)

    assert result_first is not None
    assert result_first.inviteId == "inv-test1"

    consumed_invite = _make_invite(consumed=True)
    with (
        patch.object(
            InviteRepository, "get_by_token_hash", new=AsyncMock(return_value=consumed_invite)
        ),
    ):
        result_second = await invite_service.consume_invite(token)

    assert result_second is None


@pytest.mark.asyncio
async def test_consume_invite_rejects_expired() -> None:
    expired_invite = _make_invite(
        expires_at=datetime.now(UTC) - timedelta(hours=1),
    )

    with (
        patch.object(
            InviteRepository, "get_by_token_hash", new=AsyncMock(return_value=expired_invite)
        ),
    ):
        result = await invite_service.consume_invite("rawtoken")

    assert result is None


@pytest.mark.asyncio
async def test_send_invite_email_smtp_not_configured() -> None:
    invite = _make_invite()

    mock_settings = MagicMock()
    mock_settings.is_smtp_configured.return_value = False

    with patch("app.services.invite_service.settings", mock_settings):
        result = await invite_service.send_invite_email(invite, "rawtoken")

    assert result is False


@pytest.mark.asyncio
async def test_send_invite_email_smtp_configured() -> None:
    invite = _make_invite()

    mock_settings = MagicMock()
    mock_settings.is_smtp_configured.return_value = True
    mock_settings.SMTP_HOST = "smtp.example.com"
    mock_settings.SMTP_PORT = 587
    mock_settings.SMTP_USERNAME = "user@example.com"
    mock_settings.SMTP_PASSWORD = "secret"
    mock_settings.SMTP_TLS = True
    mock_settings.SMTP_FROM_ADDRESS = "noreply@example.com"
    mock_settings.APP_NAME = "APIWeave"

    with (
        patch("app.services.invite_service.settings", mock_settings),
        patch("aiosmtplib.send", new=AsyncMock()) as mock_send,
    ):
        result = await invite_service.send_invite_email(invite, "rawtoken")

    assert result is True
    mock_send.assert_awaited_once()
    call_kwargs = mock_send.call_args
    msg = call_kwargs.args[0] if call_kwargs.args else call_kwargs.kwargs.get("message")
    assert msg is not None
    assert invite.email in str(msg["To"])
    assert "rawtoken" in str(msg.get_content()) or invite.invite_url in str(msg.get_content())


@pytest.mark.asyncio
async def test_validate_invite_token_returns_invite_without_consuming() -> None:
    invite = _make_invite(consumed=False)

    with (
        patch.object(InviteRepository, "get_by_token_hash", new=AsyncMock(return_value=invite)),
        patch.object(InviteRepository, "consume", new=AsyncMock()) as mock_consume,
    ):
        result = await invite_service.validate_invite_token("rawtoken")

    assert result is not None
    assert result.inviteId == "inv-test1"
    mock_consume.assert_not_awaited()


@pytest.mark.asyncio
async def test_validate_invite_token_returns_none_for_consumed() -> None:
    consumed_invite = _make_invite(consumed=True)

    with (
        patch.object(
            InviteRepository, "get_by_token_hash", new=AsyncMock(return_value=consumed_invite)
        ),
    ):
        result = await invite_service.validate_invite_token("rawtoken")

    assert result is None
