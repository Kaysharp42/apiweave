"""Passwordless email magic-link sign-in (multi_tenant only).

request_login_link → emails a single-use link (no enumeration: always succeeds
from the caller's view). verify_login_token → validates + consumes the token and
resolves/creates the user per REGISTRATION_MODE + approved-domains policy.

Eligibility (who may obtain a NEW account): an existing user, anyone with a
pending general/org invite, or — when REGISTRATION_MODE="open" — any email that
passes the approved-domains policy. Approved-domains is always enforced when
enabled.
"""

from __future__ import annotations

import hashlib
import logging
import secrets
import uuid
from datetime import UTC, datetime, timedelta
from email.message import EmailMessage

from fastapi import HTTPException, status

from app.config import settings
from app.models import User
from app.repositories.auth_repositories import InviteRepository, UserRepository
from app.repositories.email_auth_repository import EmailAuthTokenRepository
from app.repositories.org_invite_repository import OrgInviteRepository

logger = logging.getLogger(__name__)


def _hash_token(raw_token: str) -> str:
    return hashlib.sha256(raw_token.encode()).hexdigest()


def _normalize_email(email: str) -> str:
    return email.strip().lower()


def _as_utc(dt: datetime) -> datetime:
    """Normalize a (possibly naive) stored datetime to aware UTC. Mongo/Beanie
    returns naive UTC datetimes, which can't be compared to aware ones."""
    return dt if dt.tzinfo is not None else dt.replace(tzinfo=UTC)


async def _domain_approved(email: str) -> bool:
    # Approved-domains is enforced only when enabled; otherwise all domains pass.
    if not settings.APPROVED_DOMAINS_ENABLED:
        return True
    # Enabled: reuse the OAuth path's comprehensive env + DB check.
    from app.auth.router import _is_domain_approved

    return await _is_domain_approved(email)


async def _eligible_for_new_account(email: str) -> bool:
    """Whether an unknown email may obtain a new account (a user already
    existing is handled by the caller)."""
    if await InviteRepository.find_active_by_email(email) is not None:
        return True
    if await OrgInviteRepository.find_active_by_email(email) is not None:
        return True
    return settings.REGISTRATION_MODE == "open"


async def request_login_link(email: str) -> None:
    """Best-effort: send a magic link if the email is eligible. Never reveals
    whether an account exists (always returns None)."""
    norm = _normalize_email(email)
    if "@" not in norm:
        return
    if not await _domain_approved(norm):
        return

    user = await UserRepository.get_by_email(norm)
    if user is None and not await _eligible_for_new_account(norm):
        return  # invite-only and no user/invite — silently do nothing

    raw_token = secrets.token_urlsafe(32)
    now = datetime.now(UTC)
    await EmailAuthTokenRepository.create(
        token_id=f"eat-{uuid.uuid4().hex[:12]}",
        token_hash=_hash_token(raw_token),
        email=norm,
        created_at=now,
        expires_at=now + timedelta(minutes=settings.EMAIL_LOGIN_TOKEN_TTL_MINUTES),
    )
    await _send_login_email(norm, raw_token)


async def verify_login_token(raw_token: str) -> User:
    """Validate + consume a magic-link token and return the signed-in user,
    creating the account (per policy) on first use."""
    now = datetime.now(UTC)
    token = await EmailAuthTokenRepository.get_by_hash(_hash_token(raw_token))
    if token is None or token.consumed or _as_utc(token.expires_at) <= now:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or expired sign-in link",
        )
    # Single-use: consume before establishing the session.
    if not await EmailAuthTokenRepository.consume(token.tokenId):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or expired sign-in link",
        )

    email = token.email
    user = await UserRepository.get_by_email(email)
    if user is None:
        # Re-check policy at verify (defense-in-depth).
        if not await _domain_approved(email) or not await _eligible_for_new_account(email):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="This email is not permitted to sign in",
            )
        user = await UserRepository.create(
            user_id=f"usr-{uuid.uuid4().hex[:12]}",
            verified_email=email,
            display_name=email.split("@")[0],
            avatar_url=None,
            roles=[],
            permissions=[],
        )
        from app.services.bootstrap import ensure_personal_workspace

        await ensure_personal_workspace(user)

    return user


async def _send_login_email(email: str, raw_token: str) -> bool:
    """Send the magic link. Returns False (and logs the link) if SMTP is off."""
    verify_url = f"{settings.BASE_URL.rstrip('/')}/api/auth/email/verify?token={raw_token}"
    if not settings.is_smtp_configured():
        logger.warning(
            "SMTP not configured — magic-link email not sent to %s. Link: %s",
            email,
            verify_url,
        )
        return False

    msg = EmailMessage()
    msg["Subject"] = f"Sign in to {settings.APP_NAME}"
    msg["From"] = settings.SMTP_FROM_ADDRESS
    msg["To"] = email
    msg.set_content(
        f"Click the link below to sign in to {settings.APP_NAME}:\n\n"
        f"{verify_url}\n\n"
        f"This link expires in {settings.EMAIL_LOGIN_TOKEN_TTL_MINUTES} minutes "
        f"and can be used once. If you didn't request it, ignore this email.\n"
    )
    try:
        import aiosmtplib

        await aiosmtplib.send(
            msg,
            hostname=settings.SMTP_HOST,
            port=settings.SMTP_PORT,
            username=settings.SMTP_USERNAME,
            password=settings.SMTP_PASSWORD,
            start_tls=settings.SMTP_TLS,
        )
        return True
    except Exception:
        logger.exception("Failed to send magic-link email to %s", email)
        return False
