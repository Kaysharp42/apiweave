"""
Organization service — business logic for org CRUD, membership, and last-owner protection.

All state-changing operations produce audit events. Last-owner protection
prevents demotion or removal of the sole organization owner.
"""

from __future__ import annotations

import logging
import uuid

from fastapi import HTTPException, status

from app.auth.permissions import OrgRole, check_last_owner
from app.models import (
    Organization,
    OrganizationMember,
    OrganizationMemberResponse,
    OrganizationResponse,
    User,
)
from app.repositories.organization_repository import OrganizationRepository
from app.services import entitlements
from app.services.audit_service import append_event
from app.services.exceptions import ResourceNotFoundError
from app.utils.slug import validate_slug

logger = logging.getLogger(__name__)

VALID_ORG_ROLES = {r.value for r in OrgRole}


async def create_org(
    *,
    name: str,
    slug: str,
    owner_user: User,
    description: str | None = None,
) -> OrganizationResponse:
    # Billing seam: gate org creation. Allow-all until billing is enabled.
    await entitlements.require_can_create_org(owner_user)

    normalized_slug = validate_slug(slug)

    existing = await OrganizationRepository.get_by_slug(normalized_slug)
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"error": "slug_conflict", "slug": normalized_slug},
        )

    org = await OrganizationRepository.create(
        org_id=f"org-{uuid.uuid4().hex[:12]}",
        slug=normalized_slug,
        name=name,
        owner_user_id=owner_user.userId,
        description=description,
    )

    await OrganizationRepository.add_member(
        member_id=f"om-{uuid.uuid4().hex[:12]}",
        org_id=org.orgId,
        user_id=owner_user.userId,
        role=OrgRole.OWNER,
    )

    await append_event(
        actor="user",
        actor_id=owner_user.userId,
        action="org.created",
        scope="org",
        scope_id=org.orgId,
        resource_type="organization",
        resource_id=org.orgId,
        context={"slug": org.slug, "name": org.name},
    )

    return OrganizationResponse.model_validate(org)


async def get_org(org_slug: str) -> OrganizationResponse:
    org = await OrganizationRepository.get_by_slug(org_slug)
    if not org:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Organization not found")
    if org.deletedAt is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Organization not found")
    return OrganizationResponse.model_validate(org)


async def get_org_by_id(org_id: str) -> Organization:
    org = await OrganizationRepository.get_by_id(org_id)
    if not org:
        raise ResourceNotFoundError(f"Organization {org_id} not found")
    return org


async def update_org(
    org_slug: str,
    *,
    name: str | None = None,
    description: str | None = None,
    new_slug: str | None = None,
    actor: User,
) -> OrganizationResponse:
    org = await OrganizationRepository.get_by_slug(org_slug)
    if not org or org.deletedAt is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Organization not found")

    validated_new_slug = None
    if new_slug is not None:
        validated_new_slug = validate_slug(new_slug)
        conflict = await OrganizationRepository.get_by_slug(validated_new_slug)
        if conflict and conflict.orgId != org.orgId:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={"error": "slug_conflict", "slug": validated_new_slug},
            )

    updated = await OrganizationRepository.update(
        org.orgId,
        name=name,
        description=description,
        slug=validated_new_slug,
    )
    if not updated:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Organization not found")

    await append_event(
        actor="user",
        actor_id=actor.userId,
        action="org.updated",
        scope="org",
        scope_id=org.orgId,
        resource_type="organization",
        resource_id=org.orgId,
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

    return OrganizationResponse.model_validate(updated)


async def delete_org(org_slug: str, *, actor: User) -> dict[str, str]:
    org = await OrganizationRepository.get_by_slug(org_slug)
    if not org or org.deletedAt is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Organization not found")

    await OrganizationRepository.soft_delete(org.orgId)

    await append_event(
        actor="user",
        actor_id=actor.userId,
        action="org.deleted",
        scope="org",
        scope_id=org.orgId,
        resource_type="organization",
        resource_id=org.orgId,
        context={"slug": org.slug},
    )

    return {"status": "deleted", "orgId": org.orgId}


async def restore_org(org_slug: str, *, actor: User) -> OrganizationResponse:
    org = await OrganizationRepository.get_by_slug(org_slug)
    if not org:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Organization not found")
    if org.deletedAt is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Organization is not deleted",
        )

    restored = await OrganizationRepository.restore(org.orgId)
    if not restored:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Organization not found")

    await append_event(
        actor="user",
        actor_id=actor.userId,
        action="org.restored",
        scope="org",
        scope_id=org.orgId,
        resource_type="organization",
        resource_id=org.orgId,
        context={"slug": org.slug},
    )

    return OrganizationResponse.model_validate(restored)


async def list_orgs_for_user(user: User) -> list[OrganizationResponse]:
    orgs = await OrganizationRepository.list_by_user(user.userId)
    return [OrganizationResponse.model_validate(o) for o in orgs]


async def require_org_member(org_id: str, user_id: str) -> OrganizationMember:
    member = await OrganizationRepository.get_member(org_id, user_id)
    if not member:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not a member of this organization",
        )
    return member


async def require_org_owner(org_id: str, user_id: str) -> OrganizationMember:
    member = await require_org_member(org_id, user_id)
    if member.role != OrgRole.OWNER:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Owner role required",
        )
    return member


async def add_member(
    org_id: str,
    *,
    user_id: str,
    role: str,
    actor: User,
) -> OrganizationMemberResponse:
    if role not in VALID_ORG_ROLES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Invalid role: {role}. Must be one of: {sorted(VALID_ORG_ROLES)}",
        )

    existing = await OrganizationRepository.get_member(org_id, user_id)
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="User is already a member of this organization",
        )

    # Billing seam: a new member consumes a seat. Allow-all until billing is on.
    await entitlements.require_can_add_org_member(org_id)

    member = await OrganizationRepository.add_member(
        member_id=f"om-{uuid.uuid4().hex[:12]}",
        org_id=org_id,
        user_id=user_id,
        role=role,
    )

    await append_event(
        actor="user",
        actor_id=actor.userId,
        action="org.member.added",
        scope="org",
        scope_id=org_id,
        resource_type="organization_member",
        resource_id=member.memberId,
        context={"targetUserId": user_id, "role": role},
    )

    return OrganizationMemberResponse.model_validate(member)


async def update_member_role(
    org_id: str,
    target_user_id: str,
    *,
    new_role: str,
    actor: User,
) -> OrganizationMemberResponse:
    if new_role not in VALID_ORG_ROLES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Invalid role: {new_role}",
        )

    target = await OrganizationRepository.get_member(org_id, target_user_id)
    if not target:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Member not found",
        )

    if target.role == OrgRole.OWNER and new_role != OrgRole.OWNER:
        owner_count = await OrganizationRepository.count_owners(org_id)
        check_last_owner(owner_count)

    updated = await OrganizationRepository.update_member_role(org_id, target_user_id, new_role)
    if not updated:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Member not found")

    await append_event(
        actor="user",
        actor_id=actor.userId,
        action="org.member.role_changed",
        scope="org",
        scope_id=org_id,
        resource_type="organization_member",
        resource_id=updated.memberId,
        context={"targetUserId": target_user_id, "oldRole": target.role, "newRole": new_role},
    )

    return OrganizationMemberResponse.model_validate(updated)


async def remove_member(
    org_id: str,
    target_user_id: str,
    *,
    actor: User,
) -> dict[str, str]:
    target = await OrganizationRepository.get_member(org_id, target_user_id)
    if not target:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Member not found")

    if target.role == OrgRole.OWNER:
        owner_count = await OrganizationRepository.count_owners(org_id)
        check_last_owner(owner_count)

    await OrganizationRepository.remove_member(org_id, target_user_id)

    await append_event(
        actor="user",
        actor_id=actor.userId,
        action="org.member.removed",
        scope="org",
        scope_id=org_id,
        resource_type="organization_member",
        resource_id=target.memberId,
        context={"targetUserId": target_user_id, "role": target.role},
    )

    return {"status": "removed", "userId": target_user_id}


async def list_members(org_id: str) -> list[OrganizationMemberResponse]:
    members = await OrganizationRepository.list_members(org_id)
    return [OrganizationMemberResponse.model_validate(m) for m in members]


async def get_member(org_id: str, user_id: str) -> OrganizationMemberResponse:
    member = await OrganizationRepository.get_member(org_id, user_id)
    if not member:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Member not found")
    return OrganizationMemberResponse.model_validate(member)
