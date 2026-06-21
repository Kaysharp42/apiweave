"""
Bootstrap service — creates the first owner and default personal workspace.

Called during setup mode when the first user registers.
Also creates the default workspace environment.
"""

from __future__ import annotations

import logging
import uuid

from pymongo.errors import DuplicateKeyError

from app.models import User, Workspace
from app.repositories.workspace_repository import WorkspaceRepository
from app.services.scoped_environment_service import create_default_workspace_environment

logger = logging.getLogger(__name__)


async def ensure_personal_workspace(user: User) -> Workspace:
    """Return the user's personal workspace, creating it if missing.

    The personal workspace is keyed by ``(orgId=None, slug="personal")``
    under a unique index, so the database can hold at most one of them. If a
    prior run, a 1.0 install, or a concurrent bootstrap left an unowned
    personal workspace behind, we adopt it instead of trying to create a
    second one (which would fail with ``DuplicateKeyError``).

    Idempotent: calling it on every first-request path is safe; the personal
    workspace is found whether it was created by this user, adopted by this
    user, or created by a concurrent worker and then re-fetched here.
    """
    existing = await WorkspaceRepository.get_personal_for_user(user.userId)
    if existing:
        logger.info("Personal workspace already exists for user %s", user.userId)
        return existing

    # Adopt an orphan personal workspace left over from a prior install/run.
    # The unique (orgId, slug) index prevents creating a second one.
    orphan = await WorkspaceRepository.get_orphan_personal("personal")
    if orphan is not None:
        claimed = await WorkspaceRepository.claim_orphan_personal(orphan.workspaceId, user.userId)
        if claimed is not None:
            await _ensure_workspace_membership(claimed.workspaceId, user.userId, role="admin")
            await create_default_workspace_environment(
                workspace_id=claimed.workspaceId,
                owner_type="user",
            )
            logger.info(
                "Adopted orphan personal workspace %s for owner %s",
                claimed.workspaceId,
                user.userId,
            )
            return claimed
        # Orphan was owned by someone else — fall through and try to create.
        # The create will still fail, but the existing-owner path in
        # get_personal_for_user is the source of truth on next call.

    try:
        workspace = await WorkspaceRepository.create(
            workspace_id=f"ws-{uuid.uuid4().hex[:12]}",
            slug="personal",
            name="My Workspace",
            owner_type="user",
            owner_user_id=user.userId,
            is_personal=True,
        )
    except DuplicateKeyError:
        # Race: another worker created (or adopted) the personal workspace
        # between our orphan check and our create. Re-fetch by owner.
        existing = await WorkspaceRepository.get_personal_for_user(user.userId)
        if existing is not None:
            return existing
        # The workspace exists but isn't owned by this user — surface the
        # conflict so the caller can decide what to do. In single-user mode
        # this should be unreachable because there's only one user.
        raise

    await WorkspaceRepository.add_member(
        member_id=f"wm-{uuid.uuid4().hex[:12]}",
        workspace_id=workspace.workspaceId,
        user_id=user.userId,
        role="admin",
    )

    # Create default environment for the workspace
    await create_default_workspace_environment(
        workspace_id=workspace.workspaceId,
        owner_type="user",
    )

    logger.info(
        "Created default personal workspace %s with default environment for first owner %s",
        workspace.workspaceId,
        user.userId,
    )
    return workspace


async def _ensure_workspace_membership(
    workspace_id: str,
    user_id: str,
    role: str = "admin",
) -> None:
    """Add a workspace member if one doesn't already exist.

    The ``(workspaceId, userId)`` unique index on ``workspace_members`` would
    otherwise raise ``DuplicateKeyError`` on a second add for the same pair.
    Idempotent: safe to call after both ``create`` and ``claim_orphan_personal``.
    """
    existing = await WorkspaceRepository.get_member(workspace_id, user_id)
    if existing is not None:
        return
    await WorkspaceRepository.add_member(
        member_id=f"wm-{uuid.uuid4().hex[:12]}",
        workspace_id=workspace_id,
        user_id=user_id,
        role=role,
    )


async def bootstrap_first_owner(user: User) -> Workspace:
    """Create the first user as system/org owner and a default personal workspace.

    This is called once during setup mode when the very first user registers.
    The user becomes the owner of the system and gets a default personal workspace
    with a default environment.
    """
    return await ensure_personal_workspace(user)


async def create_workspace_with_default_env(
    workspace_id: str,
    slug: str,
    name: str,
    owner_type: str,
    owner_user_id: str | None = None,
    org_id: str | None = None,
    is_personal: bool = False,
    creator_user_id: str | None = None,
) -> Workspace:
    """Create a workspace and its default environment.

    This is the canonical way to create a workspace — it ensures
    the default environment is always created alongside.
    """
    workspace = await WorkspaceRepository.create(
        workspace_id=workspace_id,
        slug=slug,
        name=name,
        owner_type=owner_type,
        owner_user_id=owner_user_id,
        org_id=org_id,
        is_personal=is_personal,
    )

    # Add creator as admin member
    if creator_user_id:
        await WorkspaceRepository.add_member(
            member_id=f"wm-{uuid.uuid4().hex[:12]}",
            workspace_id=workspace_id,
            user_id=creator_user_id,
            role="admin",
        )

    # Create default environment
    await create_default_workspace_environment(
        workspace_id=workspace_id,
        owner_type=owner_type,
    )

    logger.info(
        "Created workspace %s (%s) with default environment",
        workspace_id,
        name,
    )
    return workspace
