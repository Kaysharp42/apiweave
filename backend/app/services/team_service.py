"""
Team service — business logic for team CRUD, membership, and permission grants.

All state-changing operations produce audit events.
"""
from __future__ import annotations

import logging
import uuid

from fastapi import HTTPException, status

from app.models import (
    TeamMemberResponse,
    TeamPermissionGrantResponse,
    TeamResponse,
    User,
)
from app.repositories.organization_repository import OrganizationRepository
from app.repositories.team_permission_grant_repository import TeamPermissionGrantRepository
from app.repositories.team_repository import TeamRepository
from app.services.audit_service import append_event
from app.services.org_service import require_org_owner
from app.utils.slug import validate_slug

logger = logging.getLogger(__name__)


async def create_team(
    org_id: str,
    *,
    name: str,
    slug: str,
    description: str | None,
    actor: User,
) -> TeamResponse:
    await require_org_owner(org_id, actor.userId)

    normalized_slug = validate_slug(slug)
    existing = await TeamRepository.get_by_slug(org_id, normalized_slug)
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"error": "slug_conflict", "slug": normalized_slug},
        )

    team = await TeamRepository.create(
        team_id=f"team-{uuid.uuid4().hex[:12]}",
        org_id=org_id,
        slug=normalized_slug,
        name=name,
        description=description,
    )

    await append_event(
        actor="user",
        actor_id=actor.userId,
        action="team.created",
        scope="org",
        scope_id=org_id,
        resource_type="team",
        resource_id=team.teamId,
        context={"slug": team.slug, "name": team.name},
    )

    return TeamResponse.model_validate(team)


async def list_teams(org_id: str) -> list[TeamResponse]:
    teams = await TeamRepository.list_by_org(org_id)
    return [TeamResponse.model_validate(t) for t in teams]


async def get_team(org_id: str, team_slug: str) -> TeamResponse:
    team = await TeamRepository.get_by_slug(org_id, team_slug)
    if not team:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Team not found")
    return TeamResponse.model_validate(team)


async def update_team(
    org_id: str,
    team_slug: str,
    *,
    name: str | None = None,
    description: str | None = None,
    new_slug: str | None = None,
    actor: User,
) -> TeamResponse:
    await require_org_owner(org_id, actor.userId)

    team = await TeamRepository.get_by_slug(org_id, team_slug)
    if not team:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Team not found")

    validated_new_slug = None
    if new_slug is not None:
        validated_new_slug = validate_slug(new_slug)
        conflict = await TeamRepository.get_by_slug(org_id, validated_new_slug)
        if conflict and conflict.teamId != team.teamId:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={"error": "slug_conflict", "slug": validated_new_slug},
            )

    updated = await TeamRepository.update(
        team.teamId,
        name=name,
        description=description,
        slug=validated_new_slug,
    )
    if not updated:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Team not found")

    await append_event(
        actor="user",
        actor_id=actor.userId,
        action="team.updated",
        scope="org",
        scope_id=org_id,
        resource_type="team",
        resource_id=team.teamId,
        context={
            "changed": {
                k: v
                for k, v in {
                    "name": name,
                    "description": description,
                    "slug": validated_new_slug,
                }.items()
                if v is not None
            }
        },
    )

    return TeamResponse.model_validate(updated)


async def delete_team(
    org_id: str,
    team_slug: str,
    *,
    actor: User,
) -> dict[str, str]:
    await require_org_owner(org_id, actor.userId)

    team = await TeamRepository.get_by_slug(org_id, team_slug)
    if not team:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Team not found")

    await TeamPermissionGrantRepository.delete_by_team(team.teamId)
    await TeamRepository.delete(team.teamId)

    await append_event(
        actor="user",
        actor_id=actor.userId,
        action="team.deleted",
        scope="org",
        scope_id=org_id,
        resource_type="team",
        resource_id=team.teamId,
        context={"slug": team.slug},
    )

    return {"status": "deleted", "teamId": team.teamId}


async def add_team_member(
    org_id: str,
    team_slug: str,
    *,
    user_id: str,
    role: str = "member",
    actor: User,
) -> TeamMemberResponse:
    await require_org_owner(org_id, actor.userId)

    team = await TeamRepository.get_by_slug(org_id, team_slug)
    if not team:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Team not found")

    org_member = await OrganizationRepository.get_member(org_id, user_id)
    if not org_member:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="User must be an organization member before joining a team",
        )

    existing = await TeamRepository.get_member(team.teamId, user_id)
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="User is already a member of this team",
        )

    member = await TeamRepository.add_member(
        member_id=f"tm-{uuid.uuid4().hex[:12]}",
        team_id=team.teamId,
        user_id=user_id,
        role=role,
    )

    await append_event(
        actor="user",
        actor_id=actor.userId,
        action="team.member.added",
        scope="org",
        scope_id=org_id,
        resource_type="team_member",
        resource_id=member.memberId,
        context={"teamId": team.teamId, "targetUserId": user_id, "role": role},
    )

    return TeamMemberResponse.model_validate(member)


async def list_team_members(org_id: str, team_slug: str) -> list[TeamMemberResponse]:
    team = await TeamRepository.get_by_slug(org_id, team_slug)
    if not team:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Team not found")
    members = await TeamRepository.list_members(team.teamId)
    return [TeamMemberResponse.model_validate(m) for m in members]


async def remove_team_member(
    org_id: str,
    team_slug: str,
    user_id: str,
    *,
    actor: User,
) -> dict[str, str]:
    await require_org_owner(org_id, actor.userId)

    team = await TeamRepository.get_by_slug(org_id, team_slug)
    if not team:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Team not found")

    removed = await TeamRepository.remove_member(team.teamId, user_id)
    if not removed:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Team member not found")

    await append_event(
        actor="user",
        actor_id=actor.userId,
        action="team.member.removed",
        scope="org",
        scope_id=org_id,
        resource_type="team_member",
        resource_id=team.teamId,
        context={"teamId": team.teamId, "targetUserId": user_id},
    )

    return {"status": "removed", "userId": user_id}


async def add_permission_grant(
    org_id: str,
    team_slug: str,
    *,
    resource_type: str,
    resource_id: str,
    permissions: list[str],
    actor: User,
) -> TeamPermissionGrantResponse:
    await require_org_owner(org_id, actor.userId)

    team = await TeamRepository.get_by_slug(org_id, team_slug)
    if not team:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Team not found")

    existing = await TeamPermissionGrantRepository.get_by_team_and_resource(
        team.teamId, resource_type, resource_id
    )
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Permission grant already exists for this team and resource",
        )

    grant = await TeamPermissionGrantRepository.create(
        grant_id=f"tg-{uuid.uuid4().hex[:12]}",
        team_id=team.teamId,
        org_id=org_id,
        resource_type=resource_type,
        resource_id=resource_id,
        permissions=permissions,
        granted_by=actor.userId,
    )

    await append_event(
        actor="user",
        actor_id=actor.userId,
        action="team.grant.added",
        scope="org",
        scope_id=org_id,
        resource_type="team_permission_grant",
        resource_id=grant.grantId,
        context={
            "teamId": team.teamId,
            "resourceType": resource_type,
            "resourceId": resource_id,
            "permissions": permissions,
        },
    )

    return TeamPermissionGrantResponse.model_validate(grant)


async def list_permission_grants(org_id: str, team_slug: str) -> list[TeamPermissionGrantResponse]:
    team = await TeamRepository.get_by_slug(org_id, team_slug)
    if not team:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Team not found")
    grants = await TeamPermissionGrantRepository.list_by_team(team.teamId)
    return [TeamPermissionGrantResponse.model_validate(g) for g in grants]


async def delete_permission_grant(
    org_id: str,
    team_slug: str,
    grant_id: str,
    *,
    actor: User,
) -> dict[str, str]:
    await require_org_owner(org_id, actor.userId)

    team = await TeamRepository.get_by_slug(org_id, team_slug)
    if not team:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Team not found")

    grant = await TeamPermissionGrantRepository.get_by_id(grant_id)
    if not grant or grant.teamId != team.teamId:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Grant not found")

    await TeamPermissionGrantRepository.delete(grant_id)

    await append_event(
        actor="user",
        actor_id=actor.userId,
        action="team.grant.removed",
        scope="org",
        scope_id=org_id,
        resource_type="team_permission_grant",
        resource_id=grant_id,
        context={"teamId": team.teamId},
    )

    return {"status": "removed", "grantId": grant_id}
