"""Session inspection and CSRF-token routes."""

from __future__ import annotations

import secrets
from datetime import UTC, datetime

from fastapi import Depends, HTTPException, Response, status

from app.auth.dependencies import csrf_protect, get_current_session, get_current_user
from app.config import settings  # noqa: E402
from app.models import Session, User, UserResponse
from app.repositories.auth_repositories import SessionRepository

from ._helpers import _user_response
from ._router import CSRF_COOKIE_NAME, router


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
