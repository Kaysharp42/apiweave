from datetime import UTC, datetime

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
    async def get_by_id(org_id: str) -> Organization | None:
        return await Organization.find_one(Organization.orgId == org_id)

    @staticmethod
    async def get_by_slug(slug: str) -> Organization | None:
        return await Organization.find_one(Organization.slug == slug)

    @staticmethod
    async def update(
        org_id: str,
        *,
        name: str | None = None,
        description: str | None = None,
        slug: str | None = None,
    ) -> Organization | None:
        org = await OrganizationRepository.get_by_id(org_id)
        if not org:
            return None
        if name is not None:
            org.name = name
        if description is not None:
            org.description = description
        if slug is not None:
            org.slug = slug
        org.updatedAt = datetime.now(UTC)
        await org.save()
        return org

    @staticmethod
    async def set_plan(org_id: str, plan: str) -> Organization | None:
        org = await OrganizationRepository.get_by_id(org_id)
        if not org:
            return None
        org.plan = plan
        org.updatedAt = datetime.now(UTC)
        await org.save()
        return org

    @staticmethod
    async def soft_delete(org_id: str) -> Organization | None:
        org = await OrganizationRepository.get_by_id(org_id)
        if not org:
            return None
        org.deletedAt = datetime.now(UTC)
        org.updatedAt = datetime.now(UTC)
        await org.save()
        return org

    @staticmethod
    async def restore(org_id: str) -> Organization | None:
        org = await OrganizationRepository.get_by_id(org_id)
        if not org:
            return None
        org.deletedAt = None
        org.updatedAt = datetime.now(UTC)
        await org.save()
        return org

    @staticmethod
    async def list_by_user(user_id: str) -> list[Organization]:
        member_recs = await OrganizationMember.find(OrganizationMember.userId == user_id).to_list()
        org_ids = [m.orgId for m in member_recs]
        if not org_ids:
            return []
        from beanie.operators import In

        return await Organization.find(
            In(Organization.orgId, org_ids),
            Organization.deletedAt == None,  # noqa: E711
        ).to_list()

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
    async def get_member(org_id: str, user_id: str) -> OrganizationMember | None:
        return await OrganizationMember.find_one(
            OrganizationMember.orgId == org_id,
            OrganizationMember.userId == user_id,
        )

    @staticmethod
    async def list_members(org_id: str) -> list[OrganizationMember]:
        return await OrganizationMember.find(OrganizationMember.orgId == org_id).to_list()

    @staticmethod
    async def count_members(org_id: str) -> int:
        return await OrganizationMember.find(OrganizationMember.orgId == org_id).count()

    @staticmethod
    async def update_member_role(
        org_id: str,
        user_id: str,
        new_role: str,
    ) -> OrganizationMember | None:
        member = await OrganizationRepository.get_member(org_id, user_id)
        if not member:
            return None
        member.role = new_role
        member.updatedAt = datetime.now(UTC)
        await member.save()
        return member

    @staticmethod
    async def remove_member(org_id: str, user_id: str) -> bool:
        member = await OrganizationRepository.get_member(org_id, user_id)
        if not member:
            return False
        await member.delete()
        return True

    @staticmethod
    async def count_owners(org_id: str) -> int:
        return await OrganizationMember.find(
            OrganizationMember.orgId == org_id,
            OrganizationMember.role == "owner",
        ).count()
