from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field

from app.auth.dependencies import require_permission
from app.auth.permissions import PRESET_ADMIN, USERS_DELETE, USERS_INVITE, USERS_READ
from app.models import User
from app.repositories.auth_repositories import InviteRepository
from app.services import invite_service

router = APIRouter(prefix="/api/invites", tags=["invites"])
logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Request / response schemas
# ---------------------------------------------------------------------------


class InviteCreateRequest(BaseModel):
    email: str
    role: str = Field(default="viewer", pattern="^(admin|editor|viewer)$")


class InviteOut(BaseModel):
    inviteId: str
    email: str
    role_preset: str
    created_by: str
    expires_at: str
    consumed: bool
    invite_url: str | None = None


# ---------------------------------------------------------------------------
# Public (no auth) — invitee validates before signing in
# ---------------------------------------------------------------------------


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


# ---------------------------------------------------------------------------
# Admin-only — invite management
# ---------------------------------------------------------------------------


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_invite(
    body: InviteCreateRequest,
    current_user: User = require_permission(USERS_INVITE),
) -> dict:
    try:
        invite, raw_token, invite_url = await invite_service.create_invite(
            email=body.email,
            role_preset=body.role,
            invited_by=current_user.userId,
        )
    except invite_service.InviteConflictError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=exc.detail,
        )

    email_sent = await invite_service.send_invite_email(invite, raw_token)

    response: dict = {
        "inviteId": invite.inviteId,
        "email": invite.email,
        "role_preset": invite.role_preset,
        "created_by": invite.created_by,
        "expires_at": invite.expires_at.isoformat(),
        "invite_url": invite_url,
        "email_sent": email_sent,
    }
    if not email_sent:
        response["warning"] = "Email not sent — copy the invite_url manually."
    return response


@router.get("")
async def list_invites(
    current_user: User = require_permission(USERS_READ),
) -> list[dict]:
    if PRESET_ADMIN not in current_user.roles:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin role required to list invites",
        )
    pending = await InviteRepository.list_pending()
    return [
        {
            "inviteId": inv.inviteId,
            "email": inv.email,
            "role_preset": inv.role_preset,
            "created_by": inv.created_by,
            "expires_at": inv.expires_at.isoformat(),
            "invite_url": inv.invite_url,
        }
        for inv in pending
    ]


@router.delete("/{invite_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_invite(
    invite_id: str,
    current_user: User = require_permission(USERS_DELETE),
) -> None:
    deleted = await InviteRepository.delete_invite(invite_id)
    if not deleted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Invite not found: {invite_id}",
        )
