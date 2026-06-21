"""
Organization API routes — full implementation.

GitHub-style nested routes for organizations, members, teams, invites,
permission grants, and outside collaborators.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, status
from pydantic import BaseModel

from app.auth.dependencies import get_current_active_user
from app.models import (
    OrganizationMemberResponse,
    OrganizationResponse,
    OrgInviteCreateResponse,
    OrgInviteResponse,
    TeamMemberResponse,
    TeamPermissionGrantResponse,
    TeamResponse,
    User,
)
from app.services import org_invite_service, org_service, team_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/orgs", tags=["orgs"])


# ---------------------------------------------------------------------------
# Request bodies
# ---------------------------------------------------------------------------


class OrgCreateRequest(BaseModel):
    name: str
    slug: str
    description: str | None = None


class OrgUpdateRequest(BaseModel):
    name: str | None = None
    description: str | None = None
    slug: str | None = None


class AddMemberRequest(BaseModel):
    user_id: str
    role: str


class UpdateRoleRequest(BaseModel):
    role: str


class TeamCreateRequest(BaseModel):
    name: str
    slug: str
    description: str | None = None


class TeamUpdateRequest(BaseModel):
    name: str | None = None
    description: str | None = None
    slug: str | None = None


class AddTeamMemberRequest(BaseModel):
    user_id: str
    role: str = "member"


class PermissionGrantRequest(BaseModel):
    resource_type: str
    resource_id: str
    permissions: list[str]


class OrgInviteRequest(BaseModel):
    email: str
    role: str


class AcceptInviteRequest(BaseModel):
    token: str


class OutsideCollaboratorRequest(BaseModel):
    user_id: str
    workspace_id: str
    role: str = "read"


# ---------------------------------------------------------------------------
# Organization CRUD
# ---------------------------------------------------------------------------


@router.get("", response_model=list[OrganizationResponse])
async def list_orgs(
    current_user: User = Depends(get_current_active_user),
) -> list[OrganizationResponse]:
    return await org_service.list_orgs_for_user(current_user)


@router.post("", response_model=OrganizationResponse, status_code=status.HTTP_201_CREATED)
async def create_org(
    body: OrgCreateRequest,
    current_user: User = Depends(get_current_active_user),
) -> OrganizationResponse:
    return await org_service.create_org(
        name=body.name,
        slug=body.slug,
        owner_user=current_user,
        description=body.description,
    )


@router.get("/healthz")
async def orgs_healthz() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/{org_slug}", response_model=OrganizationResponse)
async def get_org(
    org_slug: str,
    current_user: User = Depends(get_current_active_user),
) -> OrganizationResponse:
    return await org_service.get_org(org_slug)


@router.patch("/{org_slug}", response_model=OrganizationResponse)
async def update_org(
    org_slug: str,
    body: OrgUpdateRequest,
    current_user: User = Depends(get_current_active_user),
) -> OrganizationResponse:
    org = await org_service.get_org(org_slug)
    await org_service.require_org_member(org.orgId, current_user.userId)
    return await org_service.update_org(
        org_slug,
        name=body.name,
        description=body.description,
        new_slug=body.slug,
        actor=current_user,
    )


@router.delete("/{org_slug}")
async def delete_org(
    org_slug: str,
    current_user: User = Depends(get_current_active_user),
) -> dict[str, str]:
    org = await org_service.get_org(org_slug)
    await org_service.require_org_owner(org.orgId, current_user.userId)
    return await org_service.delete_org(org_slug, actor=current_user)


@router.post("/{org_slug}/restore", response_model=OrganizationResponse)
async def restore_org(
    org_slug: str,
    current_user: User = Depends(get_current_active_user),
) -> OrganizationResponse:
    return await org_service.restore_org(org_slug, actor=current_user)


# ---------------------------------------------------------------------------
# Members
# ---------------------------------------------------------------------------


@router.get("/{org_slug}/members", response_model=list[OrganizationMemberResponse])
async def list_members(
    org_slug: str,
    current_user: User = Depends(get_current_active_user),
) -> list[OrganizationMemberResponse]:
    org = await org_service.get_org(org_slug)
    await org_service.require_org_member(org.orgId, current_user.userId)
    return await org_service.list_members(org.orgId)


@router.post(
    "/{org_slug}/members",
    response_model=OrganizationMemberResponse,
    status_code=status.HTTP_201_CREATED,
)
async def add_member(
    org_slug: str,
    body: AddMemberRequest,
    current_user: User = Depends(get_current_active_user),
) -> OrganizationMemberResponse:
    org = await org_service.get_org(org_slug)
    await org_service.require_org_owner(org.orgId, current_user.userId)
    return await org_service.add_member(
        org.orgId,
        user_id=body.user_id,
        role=body.role,
        actor=current_user,
    )


@router.get(
    "/{org_slug}/members/{user_id}",
    response_model=OrganizationMemberResponse,
)
async def get_member(
    org_slug: str,
    user_id: str,
    current_user: User = Depends(get_current_active_user),
) -> OrganizationMemberResponse:
    org = await org_service.get_org(org_slug)
    await org_service.require_org_member(org.orgId, current_user.userId)
    return await org_service.get_member(org.orgId, user_id)


@router.patch(
    "/{org_slug}/members/{user_id}",
    response_model=OrganizationMemberResponse,
)
async def update_member_role(
    org_slug: str,
    user_id: str,
    body: UpdateRoleRequest,
    current_user: User = Depends(get_current_active_user),
) -> OrganizationMemberResponse:
    org = await org_service.get_org(org_slug)
    await org_service.require_org_owner(org.orgId, current_user.userId)
    return await org_service.update_member_role(
        org.orgId,
        user_id,
        new_role=body.role,
        actor=current_user,
    )


@router.delete("/{org_slug}/members/{user_id}")
async def remove_member(
    org_slug: str,
    user_id: str,
    current_user: User = Depends(get_current_active_user),
) -> dict[str, str]:
    org = await org_service.get_org(org_slug)
    await org_service.require_org_owner(org.orgId, current_user.userId)
    return await org_service.remove_member(org.orgId, user_id, actor=current_user)


# ---------------------------------------------------------------------------
# Invites
# ---------------------------------------------------------------------------


@router.post(
    "/{org_slug}/invites",
    response_model=OrgInviteCreateResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_invite(
    org_slug: str,
    body: OrgInviteRequest,
    current_user: User = Depends(get_current_active_user),
) -> OrgInviteCreateResponse:
    org = await org_service.get_org(org_slug)
    return await org_invite_service.create_org_invite(
        org.orgId,
        email=body.email,
        role=body.role,
        actor=current_user,
    )


@router.get("/{org_slug}/invites", response_model=list[OrgInviteResponse])
async def list_invites(
    org_slug: str,
    current_user: User = Depends(get_current_active_user),
) -> list[OrgInviteResponse]:
    org = await org_service.get_org(org_slug)
    await org_service.require_org_member(org.orgId, current_user.userId)
    return await org_invite_service.list_org_invites(org.orgId)


@router.post("/{org_slug}/invites/accept", response_model=OrgInviteResponse)
async def accept_invite(
    org_slug: str,
    body: AcceptInviteRequest,
    current_user: User = Depends(get_current_active_user),
) -> OrgInviteResponse:
    return await org_invite_service.accept_org_invite(body.token, current_user)


@router.delete("/{org_slug}/invites/{invite_id}")
async def cancel_invite(
    org_slug: str,
    invite_id: str,
    current_user: User = Depends(get_current_active_user),
) -> dict[str, str]:
    org = await org_service.get_org(org_slug)
    return await org_invite_service.cancel_org_invite(org.orgId, invite_id, actor=current_user)


# ---------------------------------------------------------------------------
# Teams
# ---------------------------------------------------------------------------


@router.get("/{org_slug}/teams", response_model=list[TeamResponse])
async def list_teams(
    org_slug: str,
    current_user: User = Depends(get_current_active_user),
) -> list[TeamResponse]:
    org = await org_service.get_org(org_slug)
    await org_service.require_org_member(org.orgId, current_user.userId)
    return await team_service.list_teams(org.orgId)


@router.post(
    "/{org_slug}/teams",
    response_model=TeamResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_team(
    org_slug: str,
    body: TeamCreateRequest,
    current_user: User = Depends(get_current_active_user),
) -> TeamResponse:
    org = await org_service.get_org(org_slug)
    return await team_service.create_team(
        org.orgId,
        name=body.name,
        slug=body.slug,
        description=body.description,
        actor=current_user,
    )


@router.get("/{org_slug}/teams/{team_slug}", response_model=TeamResponse)
async def get_team(
    org_slug: str,
    team_slug: str,
    current_user: User = Depends(get_current_active_user),
) -> TeamResponse:
    org = await org_service.get_org(org_slug)
    await org_service.require_org_member(org.orgId, current_user.userId)
    return await team_service.get_team(org.orgId, team_slug)


@router.patch("/{org_slug}/teams/{team_slug}", response_model=TeamResponse)
async def update_team(
    org_slug: str,
    team_slug: str,
    body: TeamUpdateRequest,
    current_user: User = Depends(get_current_active_user),
) -> TeamResponse:
    org = await org_service.get_org(org_slug)
    return await team_service.update_team(
        org.orgId,
        team_slug,
        name=body.name,
        description=body.description,
        new_slug=body.slug,
        actor=current_user,
    )


@router.delete("/{org_slug}/teams/{team_slug}")
async def delete_team(
    org_slug: str,
    team_slug: str,
    current_user: User = Depends(get_current_active_user),
) -> dict[str, str]:
    org = await org_service.get_org(org_slug)
    return await team_service.delete_team(org.orgId, team_slug, actor=current_user)


# ---------------------------------------------------------------------------
# Team Members
# ---------------------------------------------------------------------------


@router.get(
    "/{org_slug}/teams/{team_slug}/members",
    response_model=list[TeamMemberResponse],
)
async def list_team_members(
    org_slug: str,
    team_slug: str,
    current_user: User = Depends(get_current_active_user),
) -> list[TeamMemberResponse]:
    org = await org_service.get_org(org_slug)
    await org_service.require_org_member(org.orgId, current_user.userId)
    return await team_service.list_team_members(org.orgId, team_slug)


@router.post(
    "/{org_slug}/teams/{team_slug}/members",
    response_model=TeamMemberResponse,
    status_code=status.HTTP_201_CREATED,
)
async def add_team_member(
    org_slug: str,
    team_slug: str,
    body: AddTeamMemberRequest,
    current_user: User = Depends(get_current_active_user),
) -> TeamMemberResponse:
    org = await org_service.get_org(org_slug)
    return await team_service.add_team_member(
        org.orgId,
        team_slug,
        user_id=body.user_id,
        role=body.role,
        actor=current_user,
    )


@router.delete("/{org_slug}/teams/{team_slug}/members/{user_id}")
async def remove_team_member(
    org_slug: str,
    team_slug: str,
    user_id: str,
    current_user: User = Depends(get_current_active_user),
) -> dict[str, str]:
    org = await org_service.get_org(org_slug)
    return await team_service.remove_team_member(
        org.orgId,
        team_slug,
        user_id,
        actor=current_user,
    )


# ---------------------------------------------------------------------------
# Team Permission Grants
# ---------------------------------------------------------------------------


@router.get(
    "/{org_slug}/teams/{team_slug}/grants",
    response_model=list[TeamPermissionGrantResponse],
)
async def list_grants(
    org_slug: str,
    team_slug: str,
    current_user: User = Depends(get_current_active_user),
) -> list[TeamPermissionGrantResponse]:
    org = await org_service.get_org(org_slug)
    await org_service.require_org_member(org.orgId, current_user.userId)
    return await team_service.list_permission_grants(org.orgId, team_slug)


@router.post(
    "/{org_slug}/teams/{team_slug}/grants",
    response_model=TeamPermissionGrantResponse,
    status_code=status.HTTP_201_CREATED,
)
async def add_grant(
    org_slug: str,
    team_slug: str,
    body: PermissionGrantRequest,
    current_user: User = Depends(get_current_active_user),
) -> TeamPermissionGrantResponse:
    org = await org_service.get_org(org_slug)
    return await team_service.add_permission_grant(
        org.orgId,
        team_slug,
        resource_type=body.resource_type,
        resource_id=body.resource_id,
        permissions=body.permissions,
        actor=current_user,
    )


@router.delete("/{org_slug}/teams/{team_slug}/grants/{grant_id}")
async def delete_grant(
    org_slug: str,
    team_slug: str,
    grant_id: str,
    current_user: User = Depends(get_current_active_user),
) -> dict[str, str]:
    org = await org_service.get_org(org_slug)
    return await team_service.delete_permission_grant(
        org.orgId,
        team_slug,
        grant_id,
        actor=current_user,
    )
