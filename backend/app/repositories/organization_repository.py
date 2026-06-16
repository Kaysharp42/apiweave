from datetime import UTC, datetime
from typing import Optional

from app.models import Organization, OrganizationMember


class OrganizationRepository:
    @staticmethod
    async def create(
        org_id: str,
        slug: str,
        name: str,
        owner_user_id: str,
        description: str | None = None,
    ) -> Organization:
        now = datetime.now(UTC)
        org = Organization(
            orgId=org_id,
            slug=slug,
            name=name,
            ownerUserId=owner_user_id,
            description=description,
            createdAt=now,
            updatedAt=now,
        )
        await org.insert()
        return org

    @staticmethod
    async def get_by_id(org_id: str) -> Optional[Organization]:
        return await Organization.find_one(Organization.orgId == org_id)

    @staticmethod
    async def get_by_slug(slug: str) -> Optional[Organization]:
        return await Organization.find_one(Organization.slug == slug)

    @staticmethod
    async def add_member(
        member_id: str,
        org_id: str,
        user_id: str,
        role: str,
    ) -> OrganizationMember:
        now = datetime.now(UTC)
        member = OrganizationMember(
            memberId=member_id,
            orgId=org_id,
            userId=user_id,
            role=role,
            createdAt=now,
            updatedAt=now,
        )
        await member.insert()
        return member

    @staticmethod
    async def get_member(org_id: str, user_id: str) -> Optional[OrganizationMember]:
        return await OrganizationMember.find_one(
            OrganizationMember.orgId == org_id,
            OrganizationMember.userId == user_id,
        )

    @staticmethod
    async def list_members(org_id: str) -> list[OrganizationMember]:
        return await OrganizationMember.find(
            OrganizationMember.orgId == org_id
        ).to_list()

    @staticmethod
    async def count_owners(org_id: str) -> int:
        return await OrganizationMember.find(
            OrganizationMember.orgId == org_id,
            OrganizationMember.role == "owner",
        ).count()
