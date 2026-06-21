"""Helper (non-route) functions used by the auth router submodules.

All thirteen helper functions from the original ``router.py`` live here.
"""

from __future__ import annotations

import hashlib
import hmac
import logging
import secrets
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any
from urllib.parse import urlencode, urljoin

from fastapi import HTTPException, Request, Response, status
from pymongo.errors import DuplicateKeyError

from app.auth.permissions import PRESET_ADMIN, PRESET_VIEWER
from app.models import OAuthAccount, User, UserResponse
from app.repositories.auth_repositories import (
    ApprovedDomainRepository,
    DeletedUserRepository,
    InviteRepository,
    ProviderIdentityRepository,
    SessionRepository,
    UserRepository,
)

from ._router import CSRF_COOKIE_NAME, SESSION_COOKIE_NAME, SESSION_MAX_AGE_SECONDS

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Settings proxy
# ---------------------------------------------------------------------------


class _SettingsProxy:
    """Lazy proxy that resolves *settings* from the public package namespace.

    The original ``router.py`` exposed ``settings`` as a module-level name.
    Tests patch it via ``monkeypatch.setattr("app.auth.router.settings", …)``,
    which replaces the *reference* on the package.  If each helper submodule
    kept its own ``from app.config import settings`` those patches would be
    invisible.  The proxy always reads the current
    ``app.auth.router.settings`` attribute **at call time** so that both
    reference-replacing and attribute-mutating monkey-patches work.
    """

    def __getattr__(self, name: str) -> Any:  # noqa: ANN401
        import app.auth.router as _pkg

        return getattr(_pkg.settings, name)


settings: Any = _SettingsProxy()


# ---------------------------------------------------------------------------
# Pure helpers
# ---------------------------------------------------------------------------


def _user_response(user: User) -> UserResponse:
    return UserResponse(
        userId=user.userId,
        verified_email=user.verified_email,
        display_name=user.display_name,
        avatar_url=user.avatar_url,
        roles=user.roles,
        permissions=user.permissions,
        oauth_accounts=user.oauth_accounts,
        is_setup_complete=user.is_setup_complete,
        created_at=user.created_at,
    )


def _redirect_uri(request: Request, provider: str) -> str:
    return urljoin(
        settings.PUBLIC_BASE_URL.rstrip("/") + "/",
        f"api/auth/callback/{provider}",
    )


def _frontend_url(path: str = "/") -> str:
    base_url = settings.FRONTEND_URL
    if not base_url:
        allowed_origins = settings.get_allowed_origins_list()
        base_url = allowed_origins[0] if allowed_origins else "http://localhost:3000"
    return urljoin(base_url.rstrip("/") + "/", path.lstrip("/"))


def _frontend_login_error(detail: str) -> str:
    query = urlencode({"error": detail})
    return _frontend_url(f"/login?{query}")


def _session_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _email_domain(email: str) -> str:
    if "@" not in email:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid email format")
    return email.rsplit("@", maxsplit=1)[-1].lower()


def enforce_approved_domain(email: str) -> bool:
    """Return True if the email's domain is allowed under the approved-domains policy.

    Returns True when:
    - ``APPROVED_DOMAINS_ENABLED`` is ``False`` (policy disabled — all domains pass), OR
    - ``APPROVED_DOMAINS_ENABLED`` is ``True`` AND the email's domain appears in the
      comma-separated ``APPROVED_DOMAINS`` env var.
    """
    if not settings.APPROVED_DOMAINS_ENABLED:
        return True
    domain = _email_domain(email)
    approved = {item.lower() for item in settings.get_approved_domains_list()}
    return domain in approved


def _constant_time_match(left: str, right: str) -> bool:
    return hmac.compare_digest(left.encode("utf-8"), right.encode("utf-8"))


def _validate_nonce(provider_config: Any, stored_nonce: str, userinfo: Any):
    if not provider_config.oidc:
        return
    claims = userinfo.claims or {}
    token_nonce = claims.get("nonce")
    if token_nonce is not None and not _constant_time_match(str(token_nonce), stored_nonce):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid OAuth nonce")


async def _is_domain_approved(email: str) -> bool:
    domain = _email_domain(email)
    configured_domains = {item.lower() for item in settings.get_approved_domains_list()}
    if domain in configured_domains:
        return True
    return await ApprovedDomainRepository.is_domain_approved(domain)


async def _reconcile_orphan_invite(user: User, invite_token: str | None) -> User:
    if invite_token is not None:
        return user

    invite = await InviteRepository.find_active_by_email(user.verified_email)
    if invite is None:
        return user

    consumed = await InviteRepository.consume(invite.inviteId)
    if not consumed or user.roles:
        return user

    updated = await UserRepository.update(user.userId, roles=[invite.role_preset])
    return updated or user


async def _create_or_link_user(userinfo: Any, invite_token: str | None = None) -> User:
    if not userinfo.email or not userinfo.email_verified:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Verified email required",
        )
    if "@" not in userinfo.email:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid email format")

    if await DeletedUserRepository.is_deleted(userinfo.subject):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account has been deleted",
        )
    if await DeletedUserRepository.is_email_deleted(userinfo.email):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account has been deleted",
        )

    identity = await ProviderIdentityRepository.get_by_provider_subject(
        userinfo.provider,
        userinfo.subject,
    )
    if identity:
        user = await UserRepository.get_by_id(identity.userId)
        if user:
            return await _reconcile_orphan_invite(user, invite_token)
        await ProviderIdentityRepository.delete(identity.identityId)
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account has been deleted",
        )

    user = await UserRepository.get_by_email(userinfo.email)
    if user is not None:
        # Existing user — try to link OAuth account
        # link_oauth_account raises OAuthLinkingBlockedError (409) when:
        #   - user already has any OAuth account (incl. provider='local')
        #   - a different user already claims this email
        await UserRepository.link_oauth_account(
            user=user,
            provider=userinfo.provider,
            subject=userinfo.subject,
            email=userinfo.email,
            email_verified=userinfo.email_verified,
        )
    else:
        user_count = await UserRepository.count()
        valid_invites = await InviteRepository.get_valid_by_email(userinfo.email)
        if settings.SETUP_MODE_ENABLED and user_count == 0:
            roles = [PRESET_ADMIN]
            try:
                user = await UserRepository.create(
                    user_id=f"usr-{uuid.uuid4().hex[:12]}",
                    verified_email=userinfo.email,
                    display_name=userinfo.name,
                    avatar_url=userinfo.avatar_url,
                    roles=roles,
                    permissions=[],
                )
            except DuplicateKeyError:
                logger.warning(
                    "OAuth user creation raced for verified email %s; re-fetching existing user",
                    userinfo.email,
                )
                user = await UserRepository.get_by_email(userinfo.email)
                if user is None:
                    raise
            updated = await UserRepository.update(user.userId, is_setup_complete=True)
            user = updated or user
            settings.SETUP_MODE_ENABLED = False
            logger.warning(
                "Setup mode auto-disabled after first admin user was created (%s). "
                "Set SETUP_MODE_ENABLED=False in your environment configuration.",
                userinfo.email,
            )
        else:
            invite_to_apply = None
            if invite_token:
                token_hash = hashlib.sha256(invite_token.encode("utf-8")).hexdigest()
                invite_by_token = await InviteRepository.get_by_token_hash(token_hash)
                if (
                    invite_by_token is not None
                    and not invite_by_token.consumed
                    and invite_by_token.expires_at.replace(
                        tzinfo=(
                            UTC
                            if invite_by_token.expires_at.tzinfo is None
                            else invite_by_token.expires_at.tzinfo
                        )
                    )
                    > datetime.now(UTC)
                    and invite_by_token.email.lower() == userinfo.email.lower()
                ):
                    invite_to_apply = invite_by_token

            if invite_to_apply is not None:
                consumed = await InviteRepository.consume(invite_to_apply.inviteId)
                if not consumed:
                    raise HTTPException(
                        status_code=status.HTTP_403_FORBIDDEN,
                        detail="Access requires an invitation",
                    )
                try:
                    user = await UserRepository.create(
                        user_id=f"usr-{uuid.uuid4().hex[:12]}",
                        verified_email=userinfo.email,
                        display_name=userinfo.name,
                        avatar_url=userinfo.avatar_url,
                        roles=[invite_to_apply.role_preset],
                        permissions=[],
                    )
                except DuplicateKeyError:
                    await InviteRepository.unconsume(invite_to_apply.inviteId)
                    logger.warning(
                        "OAuth invited user creation raced for verified email %s; "
                        "re-fetching existing user",
                        userinfo.email,
                    )
                    user = await UserRepository.get_by_email(userinfo.email)
                    if user is None:
                        raise
                except Exception:
                    await InviteRepository.unconsume(invite_to_apply.inviteId)
                    raise
                updated = await UserRepository.update(user.userId, is_setup_complete=True)
                user = updated or user
            elif valid_invites:
                invite = valid_invites[0]
                consumed = await InviteRepository.consume(invite.inviteId)
                if not consumed:
                    raise HTTPException(
                        status_code=status.HTTP_403_FORBIDDEN,
                        detail="Access requires an invitation",
                    )
                try:
                    user = await UserRepository.create(
                        user_id=f"usr-{uuid.uuid4().hex[:12]}",
                        verified_email=userinfo.email,
                        display_name=userinfo.name,
                        avatar_url=userinfo.avatar_url,
                        roles=[invite.role_preset],
                        permissions=[],
                    )
                except DuplicateKeyError:
                    await InviteRepository.unconsume(invite.inviteId)
                    logger.warning(
                        "OAuth invited user creation raced for verified email %s; "
                        "re-fetching existing user",
                        userinfo.email,
                    )
                    user = await UserRepository.get_by_email(userinfo.email)
                    if user is None:
                        raise
                except Exception:
                    await InviteRepository.unconsume(invite.inviteId)
                    raise
                updated = await UserRepository.update(user.userId, is_setup_complete=True)
                user = updated or user
            elif await _is_domain_approved(userinfo.email):
                try:
                    user = await UserRepository.create(
                        user_id=f"usr-{uuid.uuid4().hex[:12]}",
                        verified_email=userinfo.email,
                        display_name=userinfo.name,
                        avatar_url=userinfo.avatar_url,
                        roles=[PRESET_VIEWER],
                        permissions=[],
                    )
                except DuplicateKeyError:
                    logger.warning(
                        "OAuth domain-approved user creation raced for verified email %s; "
                        "re-fetching existing user",
                        userinfo.email,
                    )
                    user = await UserRepository.get_by_email(userinfo.email)
                    if user is None:
                        raise
            else:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Access requires an invitation",
                )

        # New user — add the OAuth account
        oauth_account = OAuthAccount(
            provider=userinfo.provider,
            providerSubject=userinfo.subject,
            linkedAt=datetime.now(UTC),
            emailVerified=userinfo.email_verified,
        )
        user = await UserRepository.add_oauth_account(user, oauth_account)

    existing_identity = await ProviderIdentityRepository.get_by_provider_subject(
        userinfo.provider,
        userinfo.subject,
    )
    if not existing_identity:
        try:
            await ProviderIdentityRepository.create(
                identity_id=f"pid-{uuid.uuid4().hex[:12]}",
                user_id=user.userId,
                provider=userinfo.provider,
                subject=userinfo.subject,
                email=userinfo.email,
                verified=True,
            )
        except DuplicateKeyError:
            logger.warning(
                "OAuth provider identity creation raced for provider=%s subject=%s; "
                "re-fetching existing identity",
                userinfo.provider,
                userinfo.subject,
            )
            existing_identity = await ProviderIdentityRepository.get_by_provider_subject(
                userinfo.provider,
                userinfo.subject,
            )
            if existing_identity is None:
                raise
            linked_user = await UserRepository.get_by_id(existing_identity.userId)
            if linked_user:
                return await _reconcile_orphan_invite(linked_user, invite_token)
    return await _reconcile_orphan_invite(user, invite_token)


async def _create_session(response: Response, user: User):
    now = datetime.now(UTC)
    token = secrets.token_hex(32)
    await SessionRepository.create(
        session_id=f"ses-{uuid.uuid4().hex[:12]}",
        user_id=user.userId,
        token_hash=_session_hash(token),
        created_at=now,
        last_seen_at=now,
        expires_at=now + timedelta(minutes=settings.SESSION_MAX_ABSOLUTE_MINUTES),
    )
    response.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=token,
        max_age=SESSION_MAX_AGE_SECONDS,
        httponly=True,
        secure=settings.get_session_cookie_secure(),
        samesite=settings.get_session_cookie_samesite(),
        path="/",
    )
    response.set_cookie(
        key=CSRF_COOKIE_NAME,
        value=secrets.token_urlsafe(32),
        max_age=SESSION_MAX_AGE_SECONDS,
        httponly=False,
        secure=settings.get_session_cookie_secure(),
        samesite=settings.get_session_cookie_samesite(),
        path="/",
    )
