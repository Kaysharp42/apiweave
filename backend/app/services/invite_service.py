from __future__ import annotations

import hashlib
import logging
import secrets
import uuid
from datetime import UTC, datetime, timedelta
from email.message import EmailMessage
from urllib.parse import urljoin

from app.config import settings
from app.models import Invite
from app.repositories.auth_repositories import (
    DeletedUserRepository,
    InviteRepository,
    UserRepository,
)

logger = logging.getLogger(__name__)

INVITE_EXPIRY_DAYS = 7


def _frontend_url(path: str = "/") -> str:
    base_url = settings.FRONTEND_URL
    if not base_url:
        allowed_origins = settings.get_allowed_origins_list()
        base_url = allowed_origins[0] if allowed_origins else "http://localhost:3000"
    return urljoin(base_url.rstrip("/") + "/", path.lstrip("/"))


def _hash_token(raw_token: str) -> str:
    return hashlib.sha256(raw_token.encode("utf-8")).hexdigest()


async def create_invite(
    email: str,
    role_preset: str,
    invited_by: str,
) -> tuple[Invite, str, str]:
    """Create an invite.

    Returns:
        (invite_document, raw_token, invite_url)
    """
    email = email.lower()

    existing_invite = await InviteRepository.find_active_by_email(email)
    if existing_invite:
        raise InviteConflictError("An active invite already exists for this email")

    existing_user = await UserRepository.get_by_email(email)
    if existing_user:
        raise InviteConflictError("A user with this email already exists")

    raw_token = secrets.token_urlsafe(32)
    token_hash = _hash_token(raw_token)
    now = datetime.now(UTC)
    invite_url = _frontend_url(f"/invite/{raw_token}")

    invite = await InviteRepository.create(
        invite_id=f"inv-{uuid.uuid4().hex[:12]}",
        email=email,
        token_hash=token_hash,
        role_preset=role_preset,
        created_by=invited_by,
        created_at=now,
        expires_at=now + timedelta(days=INVITE_EXPIRY_DAYS),
        invite_url=invite_url,
    )

    await DeletedUserRepository.delete_by_email(email)

    return invite, raw_token, invite_url


async def consume_invite(token: str) -> Invite | None:
    """Validate and consume an invite by its raw token.

    Returns the Invite on success, None if invalid/expired/already consumed.
    """
    token_hash = _hash_token(token)
    invite = await InviteRepository.get_by_token_hash(token_hash)
    if invite is None:
        return None
    if invite.consumed:
        return None
    now = datetime.now(UTC)
    expires_at = invite.expires_at
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=UTC)
    if now >= expires_at:
        return None
    success = await InviteRepository.consume(invite.inviteId)
    if not success:
        return None
    return invite


async def validate_invite_token(token: str) -> Invite | None:
    """Check whether a token maps to a valid, unconsumed, unexpired invite.

    Does NOT consume the invite — used by the accept page to preview invite details.
    """
    token_hash = _hash_token(token)
    invite = await InviteRepository.get_by_token_hash(token_hash)
    if invite is None:
        return None
    if invite.consumed:
        return None
    now = datetime.now(UTC)
    expires_at = invite.expires_at
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=UTC)
    if now >= expires_at:
        return None
    return invite


async def send_invite_email(
    invite: Invite,
    raw_token: str,
) -> bool:
    """Send invite email via SMTP. Returns True on success, False on failure/missing config."""
    if not settings.is_smtp_configured():
        logger.warning(
            "SMTP not configured — email not sent for invite %s to %s. "
            "Copy link manually: %s",
            invite.inviteId,
            invite.email,
            invite.invite_url,
        )
        return False

    invite_url = invite.invite_url or _frontend_url(f"/invite/{raw_token}")

    msg = EmailMessage()
    msg["Subject"] = f"You're invited to join {settings.APP_NAME}"
    msg["From"] = settings.SMTP_FROM_ADDRESS
    msg["To"] = invite.email
    msg.set_content(
        f"You've been invited to join {settings.APP_NAME}.\n\n"
        f"Click the link below to accept your invitation:\n"
        f"{invite_url}\n\n"
        f"This invitation expires in {INVITE_EXPIRY_DAYS} days.\n"
    )

    try:
        import aiosmtplib

        await aiosmtplib.send(
            msg,
            hostname=settings.SMTP_HOST,
            port=settings.SMTP_PORT,
            username=settings.SMTP_USERNAME,
            password=settings.SMTP_PASSWORD,
            use_tls=settings.SMTP_TLS,
        )
        logger.info("Invite email sent to %s for invite %s", invite.email, invite.inviteId)
        return True
    except Exception:
        logger.exception(
            "Failed to send invite email for %s to %s — link: %s",
            invite.inviteId,
            invite.email,
            invite_url,
        )
        return False


class InviteConflictError(Exception):
    """Raised when an invite conflicts with an existing invite or user."""

    def __init__(self, detail: str) -> None:
        self.detail = detail
        super().__init__(detail)
