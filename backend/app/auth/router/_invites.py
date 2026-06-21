"""Invite CRUD routes and request/response models."""

from __future__ import annotations

import hashlib
import secrets
import uuid
from datetime import UTC, datetime, timedelta

from fastapi import Depends, HTTPException, status
from pydantic import BaseModel

from app.auth.dependencies import get_current_user, require_permission
from app.auth.permissions import PRESET_VIEWER, USERS_INVITE, USERS_READ
from app.models import InviteResponse, User
from app.repositories.auth_repositories import (
    DeletedUserRepository,
    InviteRepository,
    UserRepository,
)

from ._helpers import _frontend_url
from ._router import router


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
