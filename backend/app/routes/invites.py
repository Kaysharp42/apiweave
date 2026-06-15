from __future__ import annotations

from fastapi import APIRouter, HTTPException, status

from app.services import invite_service

router = APIRouter(prefix="/api/invites", tags=["invites"])


@router.get("/validate/{token}")
async def validate_invite(token: str) -> dict:
    invite = await invite_service.validate_invite_token(token)
    if invite is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Invite not found or expired",
        )
    return {
        "inviteId": invite.inviteId,
        "email": invite.email,
        "role_preset": invite.role_preset,
        "expires_at": invite.expires_at.isoformat(),
        "created_by": invite.created_by,
    }
