"""OAuth login / callback / logout / signout routes."""

from __future__ import annotations

import secrets
import uuid
from datetime import UTC, datetime, timedelta

from fastapi import Depends, HTTPException, Request, Response, status
from fastapi.responses import RedirectResponse

from app.auth.dependencies import csrf_protect, get_current_session, is_single_user_mode
from app.auth.exceptions import OAuthLinkingBlockedError
from app.config import settings  # noqa: E402
from app.models import Session
from app.repositories.auth_repositories import OAuthStateRepository, SessionRepository
from app.services.bootstrap import ensure_personal_workspace

from ._helpers import (
    _constant_time_match,
    _create_or_link_user,
    _create_session,
    _frontend_login_error,
    _frontend_url,
    _redirect_uri,
    _validate_nonce,
    enforce_approved_domain,
)
from ._router import CSRF_COOKIE_NAME, SESSION_COOKIE_NAME, router


@router.get("/login/{provider}")
async def oauth_login(provider: str, request: Request) -> RedirectResponse:
    if is_single_user_mode():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="OAuth login is disabled in single-user mode",
        )

    from app.auth.provider_registry import (
        create_login_url,
        generate_nonce,
        generate_pkce_pair,
        get_enabled_providers,
        get_provider_config,
    )

    try:
        provider_config = get_provider_config(provider)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

    if not settings.OAUTH_LOGIN_ENABLED:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="OAuth login is currently disabled",
        )

    if provider_config.name not in get_enabled_providers():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Provider not configured",
        )

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
    if is_single_user_mode():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="OAuth callback is disabled in single-user mode",
        )

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
    workspace = await ensure_personal_workspace(user)
    response = RedirectResponse(
        _frontend_url(f"/{workspace.slug}/workflows"),
        status_code=status.HTTP_302_FOUND,
    )
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
    if is_single_user_mode():
        # No session to revoke; report success so the frontend can noop.
        return {"revoked": True}

    revoked = await SessionRepository.revoke(session.sessionId)
    response.delete_cookie(
        SESSION_COOKIE_NAME,
        httponly=True,
        secure=settings.get_session_cookie_secure(),
        samesite=settings.get_session_cookie_samesite().lower(),
        path="/",
    )
    return {"revoked": revoked}


@router.post("/signout", dependencies=[Depends(csrf_protect)])
async def signout(
    response: Response,
    session: Session = Depends(get_current_session),
) -> dict[str, bool]:
    """Revoke the current session and clear the session cookie.

    Alias for /logout — used by the AccountSettings sign-out flow.
    """
    if is_single_user_mode():
        return {"revoked": True}

    revoked = await SessionRepository.revoke(session.sessionId)
    response.delete_cookie(
        SESSION_COOKIE_NAME,
        httponly=True,
        secure=settings.get_session_cookie_secure(),
        samesite=settings.get_session_cookie_samesite().lower(),
        path="/",
    )
    response.delete_cookie(
        CSRF_COOKIE_NAME,
        httponly=False,
        secure=settings.get_session_cookie_secure(),
        samesite=settings.get_session_cookie_samesite().lower(),
        path="/",
    )
    return {"revoked": revoked}
