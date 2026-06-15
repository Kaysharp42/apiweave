from __future__ import annotations

import hashlib
import hmac
import logging
import secrets
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any
from urllib.parse import urlencode, urljoin

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.responses import RedirectResponse
from pydantic import BaseModel
from pymongo.errors import DuplicateKeyError

from app.auth.dependencies import (
    csrf_protect,
    get_current_session,
    get_current_user,
    require_permission,
)
from app.auth.exceptions import OAuthLinkingBlockedError
from app.auth.permissions import (
    PRESET_ADMIN,
    PRESET_VIEWER,
    SETTINGS_READ,
    SETTINGS_UPDATE,
    USERS_INVITE,
    USERS_READ,
)
from app.auth.provider_registry import get_configured_providers
from app.config import settings
from app.models import InviteResponse, OAuthAccount, Session, User, UserResponse
from app.repositories.auth_repositories import (
    ApprovedDomainRepository,
    DeletedUserRepository,
    InviteRepository,
    OAuthStateRepository,
    ProviderIdentityRepository,
    SessionRepository,
    UserRepository,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/auth", tags=["auth"])
SESSION_COOKIE_NAME = "session"
CSRF_COOKIE_NAME = "csrftoken"
SESSION_MAX_AGE_SECONDS = 604800


@router.get("/providers")
def list_providers() -> list[dict]:
    """Return enabled status for all known OAuth providers. Public — no auth required."""
    return get_configured_providers()


def _user_response(user: User) -> UserResponse:
    return UserResponse(
        userId=user.userId,
        verified_email=user.verified_email,
        display_name=user.display_name,
        avatar_url=user.avatar_url,
        roles=user.roles,
        permissions=user.permissions,
        is_setup_complete=user.is_setup_complete,
        created_at=user.created_at,
    )


def _redirect_uri(request: Request, provider: str) -> str:
    return str(request.url_for("oauth_callback", provider=provider))


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


def _validate_nonce(provider_config: Any, stored_nonce: str, userinfo: Any) -> None:
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
                        tzinfo=UTC if invite_by_token.expires_at.tzinfo is None else invite_by_token.expires_at.tzinfo
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


async def _create_session(response: Response, user: User) -> None:
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


@router.get("/login/{provider}")
async def oauth_login(provider: str, request: Request) -> RedirectResponse:
    from app.auth.provider_registry import (
        create_login_url,
        generate_nonce,
        generate_pkce_pair,
        get_provider_config,
    )

    try:
        provider_config = get_provider_config(provider)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

    state = secrets.token_urlsafe(32)
    invite_token = request.query_params.get("invite_token")
    nonce = generate_nonce()
    code_verifier, code_challenge = generate_pkce_pair()
    redirect_uri = _redirect_uri(request, provider_config.name)
    await OAuthStateRepository.create(
        state_id=f"ost-{uuid.uuid4().hex[:12]}",
        state=state,
        code_verifier=code_verifier,
        nonce=nonce,
        provider=provider_config.name,
        redirect_uri=redirect_uri,
        expires_at=datetime.now(UTC) + timedelta(minutes=10),
        invite_token=invite_token,
    )
    login_url = create_login_url(provider_config, state, nonce, code_challenge, redirect_uri)
    return RedirectResponse(login_url, status_code=status.HTTP_302_FOUND)


@router.get("/callback/{provider}")
async def oauth_callback(provider: str, request: Request) -> RedirectResponse:
    from app.auth.provider_registry import (
        exchange_code_for_token,
        fetch_userinfo,
        get_enabled_providers,
        get_provider_config,
    )

    code = request.query_params.get("code")
    state_value = request.query_params.get("state")
    if not code or not state_value:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Missing OAuth code or state",
        )

    # T8: Gate — OAuth login must be globally enabled
    if not settings.OAUTH_LOGIN_ENABLED:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="OAuth login is currently disabled",
        )

    stored_state = await OAuthStateRepository.consume(state_value)
    if not stored_state:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or expired OAuth state",
        )
    if stored_state.expires_at.replace(tzinfo=UTC) < datetime.now(UTC):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or expired OAuth state",
        )
    if not _constant_time_match(stored_state.provider, provider.lower()):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="OAuth state provider mismatch",
        )

    try:
        provider_config = get_provider_config(provider)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

    # T8: Gate — this specific provider must be configured and enabled
    if provider.lower() not in get_enabled_providers():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Provider not configured",
        )

    redirect_uri = stored_state.redirect_uri or _redirect_uri(request, provider_config.name)
    token_response = await exchange_code_for_token(
        provider_config,
        code,
        redirect_uri,
        stored_state.code_verifier,
    )
    userinfo = await fetch_userinfo(provider_config, token_response, stored_state.code_verifier)
    _validate_nonce(provider_config, stored_state.nonce, userinfo)

    # T8: Enforce approved-domain policy BEFORE creating/linking user
    if userinfo.email and not enforce_approved_domain(userinfo.email):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Domain not approved",
        )

    try:
        invite_token = stored_state.invite_token or request.cookies.get("invite_token")
        user = await _create_or_link_user(userinfo, invite_token)
    except OAuthLinkingBlockedError:
        raise
    except HTTPException as exc:
        detail = str(exc.detail)
        login_error = "Access requires an invitation"
        should_redirect_to_login = detail in {
            login_error,
            "Account has been deleted",
        }
        if exc.status_code == status.HTTP_403_FORBIDDEN and should_redirect_to_login:
            return RedirectResponse(
                _frontend_login_error(detail),
                status_code=status.HTTP_302_FOUND,
            )
        raise
    response = RedirectResponse(_frontend_url("/"), status_code=status.HTTP_302_FOUND)
    response.delete_cookie(
        "invite_token",
        httponly=True,
        samesite="lax",
        path="/",
    )
    await _create_session(response, user)
    return response


@router.post("/logout", dependencies=[Depends(csrf_protect)])
async def logout(
    response: Response,
    session: Session = Depends(get_current_session),
) -> dict[str, bool]:
    revoked = await SessionRepository.revoke(session.sessionId)
    response.delete_cookie(
        SESSION_COOKIE_NAME,
        httponly=True,
        secure=settings.get_session_cookie_secure(),
        samesite=settings.get_session_cookie_samesite().lower(),
        path="/",
    )
    return {"revoked": revoked}


@router.get("/me", response_model=UserResponse)
async def me(
    current_user: User = Depends(get_current_user),
) -> UserResponse:
    return _user_response(current_user)


@router.post("/session/touch", dependencies=[Depends(csrf_protect)])
async def touch_session(
    session: Session = Depends(get_current_session),
) -> dict[str, str]:
    touched_at = datetime.now(UTC)
    touched = await SessionRepository.touch(session.sessionId, touched_at)
    if not touched:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid session",
        )
    return {"status": "touched", "last_seen_at": touched_at.isoformat()}


@router.get("/csrf-token")
async def csrf_token(response: Response) -> dict[str, str]:
    token = secrets.token_urlsafe(32)
    response.set_cookie(
        CSRF_COOKIE_NAME,
        token,
        httponly=False,
        secure=settings.get_session_cookie_secure(),
        samesite=settings.get_session_cookie_samesite().lower(),
        path="/",
    )
    return {"csrfToken": token}



class CreateInviteRequest(BaseModel):
    email: str
    roles: list[str]


class CreateInviteResponse(BaseModel):
    invite_url: str
    inviteId: str  # noqa: N815
    email: str
    role_preset: str


@router.post(
    "/invites",
    response_model=CreateInviteResponse,
    dependencies=[require_permission(USERS_INVITE)],
)
async def create_invite(
    body: CreateInviteRequest,
    current_user: User = Depends(get_current_user),
) -> CreateInviteResponse:
    email = body.email.lower()
    existing_invite = await InviteRepository.find_active_by_email(email)
    if existing_invite:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An active invite already exists for this email",
        )
    existing_user = await UserRepository.get_by_email(email)
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A user with this email already exists",
        )
    role_preset = body.roles[0] if body.roles else PRESET_VIEWER
    raw_token = secrets.token_urlsafe(32)
    token_hash = hashlib.sha256(raw_token.encode("utf-8")).hexdigest()
    now = datetime.now(UTC)
    invite = await InviteRepository.create(
        invite_id=f"inv-{uuid.uuid4().hex[:12]}",
        email=email,
        token_hash=token_hash,
        role_preset=role_preset,
        created_by=current_user.userId,
        created_at=now,
        expires_at=now + timedelta(days=7),
        invite_url=_frontend_url(f"/invite/{raw_token}"),
    )
    # Clear any deleted-user block: re-inviting a previously deleted user is
    # an explicit admin signal that they should be allowed back.
    await DeletedUserRepository.delete_by_email(email)

    return CreateInviteResponse(
        invite_url=invite.invite_url or _frontend_url(f"/invite/{raw_token}"),
        inviteId=invite.inviteId,
        email=invite.email,
        role_preset=invite.role_preset,
    )


@router.get(
    "/invites",
    response_model=list[InviteResponse],
    dependencies=[require_permission(USERS_READ)],
)
async def list_invites() -> list[InviteResponse]:
    invites = await InviteRepository.get_all()
    return [
        InviteResponse(
            inviteId=inv.inviteId,
            email=inv.email,
            role_preset=inv.role_preset,
            created_by=inv.created_by,
            created_at=inv.created_at,
            expires_at=inv.expires_at,
            consumed=inv.consumed,
            consumed_at=inv.consumed_at,
            invite_url=inv.invite_url,
        )
        for inv in invites
    ]



class ApprovedDomainResponse(BaseModel):
    id: str
    domain: str
    created_by: str
    created_at: datetime


class AddDomainRequest(BaseModel):
    domain: str


@router.get(
    "/domains",
    response_model=list[ApprovedDomainResponse],
    dependencies=[require_permission(SETTINGS_READ)],
)
async def list_approved_domains() -> list[ApprovedDomainResponse]:
    domains = await ApprovedDomainRepository.list_all()
    return [
        ApprovedDomainResponse(
            id=d.domainId,
            domain=d.domain,
            created_by=d.created_by,
            created_at=d.created_at,
        )
        for d in domains
    ]


@router.post(
    "/domains",
    response_model=ApprovedDomainResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[require_permission(SETTINGS_UPDATE)],
)
async def add_approved_domain(
    body: AddDomainRequest,
    current_user: User = Depends(get_current_user),
) -> ApprovedDomainResponse:
    existing = await ApprovedDomainRepository.get_by_domain(body.domain.lower())
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Domain already approved",
        )
    now = datetime.now(UTC)
    domain = await ApprovedDomainRepository.create(
        domain_id=f"dom-{uuid.uuid4().hex[:12]}",
        domain=body.domain.lower(),
        created_by=current_user.userId,
        created_at=now,
    )
    return ApprovedDomainResponse(
        id=domain.domainId,
        domain=domain.domain,
        created_by=domain.created_by,
        created_at=domain.created_at,
    )


@router.delete(
    "/domains/{domain_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[require_permission(SETTINGS_UPDATE)],
)
async def remove_approved_domain(domain_id: str) -> None:
    deleted = await ApprovedDomainRepository.delete(domain_id)
    if not deleted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Domain not found",
        )
