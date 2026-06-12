"""Bootstrap an admin user + session for security audit PoC.

This is a ONE-OFF audit helper. It:
1. Creates a verified admin user (if missing) via the User model
2. Creates a session for that user with a known token
3. Prints the session token to stdout so the caller can use it in HTTP requests

Run from backend/ with venv activated: python -m scripts.audit_bootstrap
"""
import asyncio
import hashlib
import secrets
import sys
from datetime import UTC, datetime, timedelta

# Add backend to path
sys.path.insert(0, ".")

from app.config import settings  # noqa: E402
from app.database import close_db, connect_db  # noqa: E402
from app.models import Session as SessionModel, User  # noqa: E402
from app.repositories.auth_repositories import SessionRepository, UserRepository  # noqa: E402
from app.auth.permissions import PRESET_ADMIN  # noqa: E402

TEST_EMAIL = "audit-admin@apiweave.local"
TEST_DISPLAY = "Audit Admin"


def _hash_session_token(session_token: str) -> str:
    return hashlib.sha256(session_token.encode()).hexdigest()


async def main() -> None:
    await connect_db()

    user = await UserRepository.get_by_email(TEST_EMAIL)
    if user is None:
        user_id = f"usr-{secrets.token_hex(12)}"
        user = await UserRepository.create(
            user_id=user_id,
            verified_email=TEST_EMAIL,
            display_name=TEST_DISPLAY,
            avatar_url=None,
            roles=[PRESET_ADMIN],
            permissions=[],
        )
        # Mark setup complete so first-user logic doesn't run
        await UserRepository.update(user.userId, is_setup_complete=True)
        print(f"[+] Created admin user: {user.userId} ({user.verified_email})")
    else:
        # Ensure admin role
        if PRESET_ADMIN not in (user.roles or []):
            await UserRepository.update(user.userId, roles=[PRESET_ADMIN])
        print(f"[=] Reusing existing user: {user.userId} ({user.verified_email})")

    # Create a fresh session
    session_token = secrets.token_hex(32)
    token_hash = _hash_session_token(session_token)
    now = datetime.now(UTC)
    session = await SessionRepository.create(
        session_id=f"ses-{secrets.token_hex(16)}",
        user_id=user.userId,
        token_hash=token_hash,
        created_at=now,
        last_seen_at=now,
        expires_at=now + timedelta(minutes=settings.SESSION_MAX_ABSOLUTE_MINUTES),
    )
    print(f"[+] Created session: {session.sessionId}")

    # CSRF token is independent of session - fetch from /api/auth/csrf-token
    print()
    print("=" * 60)
    print(f"SESSION_TOKEN={session_token}")
    print(f"USER_ID={user.userId}")
    print("=" * 60)
    print()
    print("Usage in curl:")
    print(f'  curl http://127.0.0.1:8000/api/workflows -b "session={session_token}"')
    print()
    print("Get CSRF token (separate request):")
    print(f'  curl http://127.0.0.1:8000/api/auth/csrf-token -b "session={session_token}" -c cookies.txt')
    print(f'  curl -X POST http://127.0.0.1:8000/api/workflows -H "Content-Type: application/json" \\')
    print(f'    -H "X-CSRF-Token: <token from above>" -b cookies.txt -d \'...\'')

    await close_db()


if __name__ == "__main__":
    asyncio.run(main())
