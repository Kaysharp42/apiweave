from datetime import UTC, datetime

from app.models import Workspace, WorkspaceMember


class WorkspaceRepository:
    @staticmethod
    async def create(
        workspace_id: str,
        slug: str,
        name: str,
        owner_type: str,
        owner_user_id: str | None = None,
        org_id: str | None = None,
        is_personal: bool = False,
        description: str | None = None,
    ) -> Workspace:
        now = datetime.now(UTC)
        ws = Workspace(
            workspaceId=workspace_id,
            slug=slug,
            name=name,
            description=description,
            ownerType=owner_type,
            ownerUserId=owner_user_id,
            orgId=org_id,
            isPersonal=is_personal,
            createdAt=now,
            updatedAt=now,
        )
        await ws.insert()
        return ws

    @staticmethod
    async def get_by_id(workspace_id: str) -> Workspace | None:
        """Get workspace by ID, excluding soft-deleted."""
        return await Workspace.find_one(
            Workspace.workspaceId == workspace_id,
            Workspace.deletedAt == None,  # noqa: E711
        )

    @staticmethod
    async def get_by_id_including_deleted(workspace_id: str) -> Workspace | None:
        """Get workspace by ID including soft-deleted (for restore/purge)."""
        return await Workspace.find_one(Workspace.workspaceId == workspace_id)

    @staticmethod
    async def get_by_slug_and_org(slug: str, org_id: str) -> Workspace | None:
        """Get workspace by slug within an organization, excluding soft-deleted."""
        return await Workspace.find_one(
            Workspace.slug == slug,
            Workspace.orgId == org_id,
            Workspace.deletedAt == None,  # noqa: E711
        )

    @staticmethod
    async def get_by_slug_and_user(slug: str, user_id: str) -> Workspace | None:
        """Get personal workspace by slug for a user, excluding soft-deleted."""
        return await Workspace.find_one(
            Workspace.slug == slug,
            Workspace.ownerType == "user",
            Workspace.ownerUserId == user_id,
            Workspace.deletedAt == None,  # noqa: E711
        )

    @staticmethod
    async def get_personal_for_user(user_id: str) -> Workspace | None:
        return await Workspace.find_one(
            Workspace.ownerType == "user",
            Workspace.ownerUserId == user_id,
            Workspace.isPersonal == True,  # noqa: E712
            Workspace.deletedAt == None,  # noqa: E711
        )

    @staticmethod
    async def get_orphan_personal(slug: str = "personal") -> Workspace | None:
        """Find an unowned personal workspace left behind by a prior run.

        The ``(orgId, slug)`` unique index permits only one
        ``(None, "personal")`` workspace in the database, so a second
        bootstrap attempt cannot create one. The first user — in single-user
        mode, or the first admin in multi-tenant setup — adopts it.

        Returns ``None`` if no such workspace exists.
        """
        return await Workspace.find_one(
            Workspace.slug == slug,
            Workspace.orgId == None,  # noqa: E711
            Workspace.ownerUserId == None,  # noqa: E711
            Workspace.isPersonal == True,  # noqa: E712
            Workspace.deletedAt == None,  # noqa: E711
        )

    @staticmethod
    async def claim_orphan_personal(
        workspace_id: str,
        user_id: str,
        name: str = "My Workspace",
    ) -> Workspace | None:
        """Take ownership of an unowned personal workspace.

        Idempotent: if the workspace is already owned by ``user_id``, this
        is a no-op and the workspace is returned. If it is owned by a
        different user, the function refuses (returns ``None``); the caller
        must decide whether to fail or fall back to a fresh create.
        """
        ws = await WorkspaceRepository.get_by_id(workspace_id)
        if ws is None:
            return None
        if ws.ownerUserId is not None and ws.ownerUserId != user_id:
            return None
        ws.ownerType = "user"
        ws.ownerUserId = user_id
        ws.isPersonal = True
        ws.name = name
        ws.updatedAt = datetime.now(UTC)
        await ws.save()
        return ws

    @staticmethod
    async def force_transfer_to_user(
        workspace_id: str,
        user_id: str,
    ) -> Workspace | None:
        """Reassign a workspace to ``user_id`` regardless of current owner.

        Unlike ``claim_orphan_personal``, this transfers ownership even when
        a different user already owns the workspace. Operator-only path used
        by ``scripts/adopt_workspace.py`` when migrating data across a
        DEPLOYMENT_MODE switch from multi_tenant to single_user.
        """
        ws = await WorkspaceRepository.get_by_id(workspace_id)
        if ws is None:
            return None
        ws.ownerType = "user"
        ws.ownerUserId = user_id
        ws.isPersonal = True
        ws.updatedAt = datetime.now(UTC)
        await ws.save()
        return ws

    @staticmethod
    async def update(
        workspace_id: str,
        *,
        name: str | None = None,
        slug: str | None = None,
        description: str | None = None,
    ) -> Workspace | None:
        """Update workspace fields. Returns updated workspace or None."""
        ws = await WorkspaceRepository.get_by_id(workspace_id)
        if not ws:
            return None
        if name is not None:
            ws.name = name
        if slug is not None:
            ws.slug = slug
        if description is not None:
            ws.description = description
        ws.updatedAt = datetime.now(UTC)
        await ws.save()
        return ws

    @staticmethod
    async def soft_delete(workspace_id: str) -> bool:
        """Soft-delete a workspace by setting deletedAt."""
        ws = await WorkspaceRepository.get_by_id(workspace_id)
        if not ws:
            return False
        ws.deletedAt = datetime.now(UTC)
        ws.updatedAt = datetime.now(UTC)
        await ws.save()
        return True

    @staticmethod
    async def restore(workspace_id: str) -> Workspace | None:
        """Restore a soft-deleted workspace."""
        ws = await WorkspaceRepository.get_by_id_including_deleted(workspace_id)
        if not ws or not ws.deletedAt:
            return None
        ws.deletedAt = None
        ws.updatedAt = datetime.now(UTC)
        await ws.save()
        return ws

    @staticmethod
    async def purge(workspace_id: str) -> bool:
        """Permanently delete a workspace and all related data."""
        ws = await WorkspaceRepository.get_by_id_including_deleted(workspace_id)
        if not ws:
            return False
        await ws.delete()
        return True

    @staticmethod
    async def list_by_org(org_id: str) -> list[Workspace]:
        """List all non-deleted workspaces for an organization."""
        return await Workspace.find(
            Workspace.orgId == org_id,
            Workspace.deletedAt == None,  # noqa: E711
        ).sort(-Workspace.createdAt).to_list()

    @staticmethod
    async def list_by_user(user_id: str) -> list[Workspace]:
        """List all non-deleted workspaces owned by or member of for a user."""
        direct = await Workspace.find(
            Workspace.ownerUserId == user_id,
            Workspace.deletedAt == None,  # noqa: E711
        ).to_list()
        member_recs = await WorkspaceMember.find(
            WorkspaceMember.userId == user_id
        ).to_list()
        member_ws_ids = {m.workspaceId for m in member_recs}
        for ws in direct:
            member_ws_ids.discard(ws.workspaceId)
        if member_ws_ids:
            from beanie.operators import In
            by_membership = await Workspace.find(
                In(Workspace.workspaceId, list(member_ws_ids)),
                Workspace.deletedAt == None,  # noqa: E711
            ).to_list()
            return direct + by_membership
        return direct

    @staticmethod
    async def add_member(
        member_id: str,
        workspace_id: str,
        user_id: str,
        role: str,
    ) -> WorkspaceMember:
        now = datetime.now(UTC)
        member = WorkspaceMember(
            memberId=member_id,
            workspaceId=workspace_id,
            userId=user_id,
            role=role,
            createdAt=now,
            updatedAt=now,
        )
        await member.insert()
        return member

    @staticmethod
    async def get_member(workspace_id: str, user_id: str) -> WorkspaceMember | None:
        return await WorkspaceMember.find_one(
            WorkspaceMember.workspaceId == workspace_id,
            WorkspaceMember.userId == user_id,
        )

    @staticmethod
    async def update_member_role(
        workspace_id: str,
        user_id: str,
        role: str,
    ) -> WorkspaceMember | None:
        """Update a workspace member's role."""
        member = await WorkspaceRepository.get_member(workspace_id, user_id)
        if not member:
            return None
        member.role = role
        member.updatedAt = datetime.now(UTC)
        await member.save()
        return member

    @staticmethod
    async def remove_member(workspace_id: str, user_id: str) -> bool:
        """Remove a member from a workspace."""
        member = await WorkspaceRepository.get_member(workspace_id, user_id)
        if not member:
            return False
        await member.delete()
        return True

    @staticmethod
    async def list_members(workspace_id: str) -> list[WorkspaceMember]:
        """List all members of a workspace."""
        return await WorkspaceMember.find(
            WorkspaceMember.workspaceId == workspace_id
        ).to_list()

    @staticmethod
    async def check_slug_available(
        slug: str,
        *,
        org_id: str | None = None,
        user_id: str | None = None,
    ) -> bool:
        """Check if a slug is available within the given scope."""
        if org_id:
            existing = await Workspace.find_one(
                Workspace.slug == slug,
                Workspace.orgId == org_id,
                Workspace.deletedAt == None,  # noqa: E711
            )
        elif user_id:
            existing = await Workspace.find_one(
                Workspace.slug == slug,
                Workspace.ownerType == "user",
                Workspace.ownerUserId == user_id,
                Workspace.deletedAt == None,  # noqa: E711
            )
        else:
            return False
        return existing is None
