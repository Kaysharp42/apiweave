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
    # Single source of truth shared with the OAuth signup path.
    from app.auth.router import domain_allowed

    return await domain_allowed(email)


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

    raw_token = await _issue_token(norm)
    await _send_login_email(norm, raw_token)


async def _issue_token(email_norm: str) -> str:
    """Create a single-use magic-link token for an email; return the raw token."""
    raw_token = secrets.token_urlsafe(32)
    now = datetime.now(UTC)
    await EmailAuthTokenRepository.create(
        token_id=f"eat-{uuid.uuid4().hex[:12]}",
        token_hash=_hash_token(raw_token),
        email=email_norm,
        created_at=now,
        expires_at=now + timedelta(minutes=settings.EMAIL_LOGIN_TOKEN_TTL_MINUTES),
    )
    return raw_token


async def send_org_invite_link(email: str, org_name: str) -> None:
    """Email an org-invite magic link (best-effort). Clicking it signs the user
    in (creating the account if needed) and auto-accepts the pending invite."""
    if not settings.EMAIL_LOGIN_ENABLED:
        return  # the verify endpoint is disabled; link would not work
    norm = _normalize_email(email)
    raw_token = await _issue_token(norm)
    await _send_org_invite_email(norm, raw_token, org_name)


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

    # Clicking the emailed link proves ownership of the address — accept any
    # pending org invites for it (org invite = magic link). Best-effort: a
    # failure here must not block sign-in.
    try:
        from app.services import org_invite_service

        await org_invite_service.accept_pending_invites_for_user(user)
    except Exception:
        logger.warning("Auto-accept of org invites failed for %s", email, exc_info=True)

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
    return await _smtp_send(msg, email)


async def _send_org_invite_email(email: str, raw_token: str, org_name: str) -> bool:
    """Send an org-invite magic link. Returns False (and logs) if SMTP is off."""
    verify_url = f"{settings.BASE_URL.rstrip('/')}/api/auth/email/verify?token={raw_token}"
    if not settings.is_smtp_configured():
        logger.warning(
            "SMTP not configured — org-invite email not sent to %s (org %s). Link: %s",
            email,
            org_name,
            verify_url,
        )
        return False

    msg = EmailMessage()
    msg["Subject"] = f"You're invited to {org_name} on {settings.APP_NAME}"
    msg["From"] = settings.SMTP_FROM_ADDRESS
    msg["To"] = email
    msg.set_content(
        f"You've been invited to join {org_name} on {settings.APP_NAME}.\n\n"
        f"Click the link below to sign in and accept the invitation:\n\n"
        f"{verify_url}\n\n"
        f"This link expires in {settings.EMAIL_LOGIN_TOKEN_TTL_MINUTES} minutes "
        f"and can be used once.\n"
    )
    return await _smtp_send(msg, email)


async def _smtp_send(msg: EmailMessage, email: str) -> bool:
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
        logger.exception("Failed to send email to %s", email)
        return False
