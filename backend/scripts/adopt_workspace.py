"""
Reassign an existing workspace to the single-user synthetic owner.

Used when an operator switches DEPLOYMENT_MODE from multi_tenant to single_user
and wants to preserve a workspace that was created by a real OAuth user. The
single-user mode only ever queries the synthetic owner's workspaces, so without
this step the old workspace becomes invisible (data is preserved in the DB but
not reachable from the UI).

Usage:
    cd backend
    python scripts/adopt_workspace.py <workspaceId>
"""

import asyncio
import sys
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.auth.single_user import (
    SINGLE_USER_OWNER_EMAIL,
    SINGLE_USER_OWNER_ID,
    SINGLE_USER_OWNER_NAME,
)
from app.database import close_db, connect_db
from app.models import User
from app.repositories.auth_repositories import UserRepository
from app.repositories.workspace_repository import WorkspaceRepository


async def _ensure_implicit_owner() -> User:
    user = await UserRepository.get_by_id(SINGLE_USER_OWNER_ID)
    if user is not None:
        return user
    return await UserRepository.create(
        user_id=SINGLE_USER_OWNER_ID,
        verified_email=SINGLE_USER_OWNER_EMAIL,
        display_name=SINGLE_USER_OWNER_NAME,
        avatar_url=None,
        roles=["admin"],
        permissions=[],
    )


async def adopt_workspace(workspace_id: str) -> int:
    await connect_db()
    try:
        ws = await WorkspaceRepository.get_by_id(workspace_id)
        if ws is None:
            print(f"ERROR: workspace {workspace_id} not found (or soft-deleted).")
            return 2

        owner = await _ensure_implicit_owner()
        previous_owner = ws.ownerUserId

        if previous_owner == owner.userId:
            print(
                f"Workspace {workspace_id} is already owned by the single-user "
                f"owner ({owner.userId}). No changes."
            )
        else:
            conflict = await WorkspaceRepository.get_by_slug_and_user(ws.slug, owner.userId)
            if conflict is not None and conflict.workspaceId != ws.workspaceId:
                print(
                    f"ERROR: the single-user owner already has a workspace at "
                    f"slug {ws.slug!r} ({conflict.workspaceId}). The unique "
                    f"(ownerUserId, slug) index forbids two. Either:\n"
                    f"  - Delete {conflict.workspaceId} manually first, or\n"
                    f"  - Wipe the database with scripts/wipe_db.py "
                    f"(destructive) and start fresh."
                )
                return 3

            await WorkspaceRepository.force_transfer_to_user(workspace_id, owner.userId)
            print(
                f"Reassigned workspace {workspace_id} from {previous_owner!r} "
                f"to single-user owner {owner.userId}."
            )

        existing_member = await WorkspaceRepository.get_member(workspace_id, owner.userId)
        if existing_member is None:
            await WorkspaceRepository.add_member(
                member_id=f"wm-{uuid.uuid4().hex[:12]}",
                workspace_id=workspace_id,
                user_id=owner.userId,
                role="admin",
            )
            print(f"Added admin membership for {owner.userId}.")
        else:
            print(f"Admin membership for {owner.userId} already exists.")

        return 0
    finally:
        await close_db()


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Usage: python scripts/adopt_workspace.py <workspaceId>")
        sys.exit(1)
    sys.exit(asyncio.run(adopt_workspace(sys.argv[1])))
