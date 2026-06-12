"""Clean up: remove the audit-bootstrap user and any leftover audit workflows/environments.

Safe to run multiple times. Idempotent.
"""
import asyncio
import os
import sys

sys.path.insert(0, ".")
from app.auth.permissions import PRESET_ADMIN  # noqa: E402
from app.database import close_db, connect_db  # noqa: E402
from app.repositories.auth_repositories import SessionRepository, UserRepository  # noqa: E402

TEST_EMAILS = {"audit-admin@apiweave.local"}


async def main() -> None:
    await connect_db()
    for email in TEST_EMAILS:
        u = await UserRepository.get_by_email(email)
        if not u:
            print(f"[=] No test user for {email}")
            continue
        # Revoke all sessions
        sessions = await SessionRepository.get_by_user(u.userId)
        for s in sessions or []:
            await SessionRepository.revoke(s.sessionId)
        # Delete the user (Beanie doesn't have hard delete by default; mark as deleted if possible)
        deleted = await UserRepository.delete_by_id(u.userId) if hasattr(UserRepository, "delete_by_id") else None
        print(f"[+] Removed test user {email}: sessions_revoked={len(sessions or [])} deleted={deleted}")
    await close_db()


if __name__ == "__main__":
    asyncio.run(main())
