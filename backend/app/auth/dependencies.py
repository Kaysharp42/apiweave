from __future__ import annotations

import hashlib
import secrets
from datetime import UTC, datetime, timedelta

from fastapi import Depends, HTTPException, Request, status

from app.auth.permissions import PermissionEvaluator, ScopedPermissionEvaluator
from app.auth.scope_resolver import ResourceScopeResolver
from app.config import settings
from app.models import Session, User
from app.repositories.auth_repositories import SessionRepository, UserRepository

SESSION_COOKIE_NAME = "session"
CSRF_COOKIE_NAME = "csrftoken"
CSRF_HEADER_NAME = "X-CSRF-Token"
STATE_CHANGING_METHODS = {"POST", "PUT", "PATCH", "DELETE"}


def hash_session_token(session_token: str) -> str:
    return hashlib.sha256(session_token.encode()).hexdigest()


def is_single_user_mode() -> bool:
    return settings.DEPLOYMENT_MODE == "single_user"


async def get_current_session(request: Request) -> Session:
    if is_single_user_mode():
        # No sessions in single-user mode; placeholder for type compat.
        # Callers that need a real Session (e.g. logout) should branch on
        # is_single_user_mode() before depending on this.
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Sessions are disabled in single-user mode",
        )

    session_token = request.cookies.get(SESSION_COOKIE_NAME)
    if not session_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
        )

    session = await SessionRepository.get_by_token_hash(hash_session_token(session_token))
    if not session:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid session",
        )

    if not SessionRepository.is_active(session):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Session expired",
        )

    request.state.session = session
    request.state.session_token = session_token
    return session


async def get_current_user(request: Request) -> User:
    """Resolve the current authenticated user.

    In ``single_user`` mode, returns the synthetic implicit owner (lazily
    bootstrapped on first call). In ``multi_tenant`` mode, validates the
    session cookie and loads the corresponding ``User`` document.

    Note: the session lookup is invoked imperatively inside the multi-tenant
    branch — NOT as a ``Depends()`` default argument — because FastAPI evaluates
    default-argument dependencies *before* the function body runs. Putting
    ``get_current_session`` in the signature would raise 404 in single-user
    mode, where sessions are disabled, before the early-return can fire.
    """
    if is_single_user_mode():
        from app.auth.single_user import get_or_create_implicit_owner

        user = await get_or_create_implicit_owner()
        request.state.user = user
        return user

    # multi_tenant: resolve session imperatively so single_user can short-circuit
    # above without paying the cost (or the 404) of the session lookup.
    session = await get_current_session(request)
    await SessionRepository.touch(session.sessionId, datetime.now(UTC))

    user = await UserRepository.get_by_id(session.userId)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found",
        )

    request.state.user = user
    return user


async def get_current_active_user(
    current_user: User = Depends(get_current_user),
) -> User:
    return current_user


def require_permission(permission: str):
    async def _check_permission(
        current_user: User = Depends(get_current_active_user),
    ) -> User:
        effective = PermissionEvaluator.get_effective_permissions(
            current_user.roles,
            current_user.permissions,
        )
        if not PermissionEvaluator.has_permission(effective, permission):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Missing required permission: {permission}",
            )
        return current_user

    return Depends(_check_permission)


def require_scoped_permission(resource: str, action: str):
    async def _check_scoped_permission(
        request: Request,
        current_user: User = Depends(get_current_active_user),
    ) -> User:
        resolved = ResourceScopeResolver.from_request(request, resource, action)
        scope_context = ResourceScopeResolver.build_scope_context(current_user, resolved)

        effective = ScopedPermissionEvaluator.evaluate(
            org_role=scope_context["org_role"],
            workspace_role=scope_context["workspace_role"],
            team_grants=scope_context["team_grants"],
            outside_collaborator_permissions=scope_context["outside_collaborator_permissions"],
            service_token_permissions=scope_context["service_token_permissions"],
            global_roles=scope_context["global_roles"],
            global_permissions=scope_context["global_permissions"],
        )

        if not ScopedPermissionEvaluator.has_permission(effective, resolved.required_permission):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Missing required permission: {resolved.required_permission}",
            )
        return current_user

    return Depends(_check_scoped_permission)


async def csrf_protect(request: Request) -> None:
    if is_single_user_mode():
        # No sessions = no CSRF surface. State-changing requests are
        # implicitly authorized by get_current_user returning the owner.
        return

    if request.method.upper() not in STATE_CHANGING_METHODS:
        return

    cookie_token = request.cookies.get(CSRF_COOKIE_NAME)
    header_token = request.headers.get(CSRF_HEADER_NAME)
    if not cookie_token or not header_token:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="CSRF token missing",
        )
    if not secrets.compare_digest(cookie_token, header_token):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="CSRF token mismatch",
        )


async def create_session_for_user(user_id: str) -> tuple[Session, str]:
    now = datetime.now(UTC)
    session_token = secrets.token_hex(32)
    session = await SessionRepository.create(
        session_id=f"ses-{secrets.token_hex(16)}",
        user_id=user_id,
        token_hash=hash_session_token(session_token),
        created_at=now,
        last_seen_at=now,
        expires_at=now + timedelta(minutes=settings.SESSION_MAX_ABSOLUTE_MINUTES),
    )
    return session, session_token


async def rotate_session(old_session: Session) -> tuple[Session, str]:
    await SessionRepository.revoke(old_session.sessionId)
    return await create_session_for_user(old_session.userId)
