"""
Bootstrap service — creates the first owner and default personal workspace.

Called during setup mode when the first user registers.
Also creates the default workspace environment.
"""
from __future__ import annotations

import logging
import uuid

from app.models import User, Workspace
from app.repositories.workspace_repository import WorkspaceRepository
from app.services.scoped_environment_service import create_default_workspace_environment

logger = logging.getLogger(__name__)


async def bootstrap_first_owner(user: User) -> Workspace:
    """Create the first user as system/org owner and a default personal workspace.

    This is called once during setup mode when the very first user registers.
    The user becomes the owner of the system and gets a default personal workspace
    with a default environment.
    """
    existing = await WorkspaceRepository.get_personal_for_user(user.userId)
    if existing:
        logger.info("Personal workspace already exists for user %s", user.userId)
        return existing

    workspace = await WorkspaceRepository.create(
        workspace_id=f"ws-{uuid.uuid4().hex[:12]}",
        slug="personal",
        name="My Workspace",
        owner_type="user",
        owner_user_id=user.userId,
        is_personal=True,
    )

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
