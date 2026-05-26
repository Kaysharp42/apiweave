from __future__ import annotations

import hashlib
import secrets
import uuid
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from app.auth.dependencies import get_current_user, require_permission
from app.auth.permissions import (
    SETTINGS_READ,
    SETTINGS_UPDATE,
    USERS_DELETE,
    USERS_INVITE,
    USERS_READ,
    USERS_UPDATE_ROLE,
)
from app.auth.provider_registry import get_configured_providers
from app.models import Invite, InviteResponse, User, UserResponse
from app.repositories.auth_repositories import (
    ApprovedDomainRepository,
    InviteRepository,
    UserRepository,
)

router = APIRouter(prefix="/api", tags=["admin-users"])


class UpdateRolesRequest(BaseModel):
    roles: list[str]


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


@router.get(
    "/users",
    response_model=list[UserResponse],
    dependencies=[require_permission(USERS_READ)],
)
async def list_users() -> list[UserResponse]:
    users = await UserRepository.get_all()
    return [_user_response(u) for u in users]


@router.patch(
    "/users/{user_id}/roles",
    response_model=UserResponse,
    dependencies=[require_permission(USERS_UPDATE_ROLE)],
)
async def update_user_roles(
    user_id: str,
    body: UpdateRolesRequest,
) -> UserResponse:
    updated = await UserRepository.update(user_id, roles=body.roles)
    if not updated:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )
    return _user_response(updated)


@router.delete(
    "/users/{user_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[require_permission(USERS_DELETE)],
)
async def delete_user(user_id: str) -> None:
    deleted = await UserRepository.delete(user_id)
    if not deleted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )


class ProviderStatusResponse(BaseModel):
    id: str
    enabled: bool


@router.get(
    "/settings/providers",
    response_model=list[ProviderStatusResponse],
    dependencies=[require_permission(SETTINGS_READ)],
)
async def list_provider_status() -> list[ProviderStatusResponse]:
    """Return enabled/disabled status for all known SSO providers. Admin-only."""
    providers = get_configured_providers()
    return [ProviderStatusResponse(id=p["id"], enabled=p["enabled"]) for p in providers]


@router.get(
    "/settings/users",
    response_model=list[UserResponse],
    dependencies=[require_permission(USERS_READ)],
)
async def settings_list_users() -> list[UserResponse]:
    users = await UserRepository.get_all()
    return [_user_response(u) for u in users]


class UpdatePermissionsRequest(BaseModel):
    roles: list[str]
    permissions: list[str] = []


@router.patch(
    "/settings/users/{user_id}/permissions",
    response_model=UserResponse,
    dependencies=[require_permission(USERS_UPDATE_ROLE)],
)
async def settings_update_user_permissions(
    user_id: str,
    body: UpdatePermissionsRequest,
) -> UserResponse:
    updated = await UserRepository.update(user_id, roles=body.roles, permissions=body.permissions)
    if not updated:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )
    return _user_response(updated)


class SettingsCreateInviteRequest(BaseModel):
    email: str
    role_preset: str = "viewer"


class SettingsCreateInviteResponse(BaseModel):
    invite_url: str
    inviteId: str
    email: str
    role_preset: str


@router.post(
    "/settings/invites",
    response_model=SettingsCreateInviteResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[require_permission(USERS_INVITE)],
)
async def settings_create_invite(
    body: SettingsCreateInviteRequest,
    current_user: User = Depends(get_current_user),
) -> SettingsCreateInviteResponse:
    raw_token = secrets.token_urlsafe(32)
    token_hash = hashlib.sha256(raw_token.encode("utf-8")).hexdigest()
    now = datetime.now(UTC)
    invite: Invite = await InviteRepository.create(
        invite_id=f"inv-{uuid.uuid4().hex[:12]}",
        email=body.email,
        token_hash=token_hash,
        role_preset=body.role_preset,
        created_by=current_user.userId,
        created_at=now,
        expires_at=now + timedelta(days=7),
    )
    return SettingsCreateInviteResponse(
        invite_url=f"/invite?token={raw_token}",
        inviteId=invite.inviteId,
        email=invite.email,
        role_preset=invite.role_preset,
    )


@router.get(
    "/settings/invites",
    response_model=list[InviteResponse],
    dependencies=[require_permission(USERS_READ)],
)
async def settings_list_invites() -> list[InviteResponse]:
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
        )
        for inv in invites
    ]


class SettingsDomainResponse(BaseModel):
    id: str
    domain: str
    created_by: str
    created_at: datetime


@router.get(
    "/settings/domains",
    response_model=list[SettingsDomainResponse],
    dependencies=[require_permission(SETTINGS_READ)],
)
async def settings_list_domains() -> list[SettingsDomainResponse]:
    domains = await ApprovedDomainRepository.list_all()
    return [
        SettingsDomainResponse(
            id=d.domainId,
            domain=d.domain,
            created_by=d.created_by,
            created_at=d.created_at,
        )
        for d in domains
    ]


class SettingsAddDomainRequest(BaseModel):
    domain: str


@router.post(
    "/settings/domains",
    response_model=SettingsDomainResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[require_permission(SETTINGS_UPDATE)],
)
async def settings_add_domain(
    body: SettingsAddDomainRequest,
    current_user: User = Depends(get_current_user),
) -> SettingsDomainResponse:
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
    return SettingsDomainResponse(
        id=domain.domainId,
        domain=domain.domain,
        created_by=domain.created_by,
        created_at=domain.created_at,
    )


@router.delete(
    "/settings/domains/{domain_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[require_permission(SETTINGS_UPDATE)],
)
async def settings_remove_domain(domain_id: str) -> None:
    deleted = await ApprovedDomainRepository.delete(domain_id)
    if not deleted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Domain not found",
        )

