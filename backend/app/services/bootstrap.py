"""
Bootstrap service — creates the first owner and default personal workspace.

Called during setup mode when the first user registers.
"""
from __future__ import annotations

import logging
import uuid
from datetime import UTC, datetime

from app.models import User
from app.repositories.organization_repository import OrganizationRepository
from app.repositories.workspace_repository import WorkspaceRepository

logger = logging.getLogger(__name__)


async def bootstrap_first_owner(user: User) -> Workspace:
    """Create the first user as system/org owner and a default personal workspace.

    This is called once during setup mode when the very first user registers.
    The user becomes the owner of the system and gets a default personal workspace.
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

    logger.info(
        "Created default personal workspace %s for first owner %s",
        workspace.workspaceId,
        user.userId,
    )
    return workspace
