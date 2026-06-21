"""Single-user mode: implicit owner bootstrap.

When ``settings.DEPLOYMENT_MODE == "single_user"`` the entire app is treated as
belonging to one user. There are no sessions, no CSRF, no OAuth. Every request
is authenticated as a single, well-known ``User`` document that is created
lazily on first access.

The owner is a *real* ``User`` row in MongoDB — not a fake in-memory object —
so it participates in workspace bootstrap, role/permission checks, the
``ScopedPermissionEvaluator`` (P1 work), and every other code path that expects
a ``User``. Downstream code is unaware that this user is synthetic.

Stable ``userId`` (``usr-single-user-owner``) so the same row is found on
every cold start. ``ensure_personal_workspace`` is idempotent — calling it on
every first-request path is safe; the repository checks for an existing
personal workspace before creating one.
"""

from __future__ import annotations

import asyncio
import logging

from app.models import User
from app.repositories.auth_repositories import UserRepository
from app.services.bootstrap import ensure_personal_workspace

logger = logging.getLogger(__name__)

SINGLE_USER_OWNER_ID = "usr-single-user-owner"
SINGLE_USER_OWNER_EMAIL = "owner@localhost"
SINGLE_USER_OWNER_NAME = "Owner"

_cached_owner: User | None = None
_bootstrap_lock = asyncio.Lock()


async def get_or_create_implicit_owner() -> User:
    """Return the singleton implicit owner, creating it on first call.

    Safe under concurrent requests on cold start — the asyncio.Lock serializes
    the initial bootstrap; once cached, the lock is a no-op fast path.
    """
    global _cached_owner

    if _cached_owner is not None:
        return _cached_owner

    async with _bootstrap_lock:
        if _cached_owner is not None:
            return _cached_owner

        user = await UserRepository.get_by_id(SINGLE_USER_OWNER_ID)
        if user is None:
            try:
                user = await UserRepository.create(
                    user_id=SINGLE_USER_OWNER_ID,
                    verified_email=SINGLE_USER_OWNER_EMAIL,
                    display_name=SINGLE_USER_OWNER_NAME,
                    avatar_url=None,
                    roles=["admin"],
                    permissions=[],
                )
                logger.info(
                    "Single-user mode: created implicit owner %s (%s)",
                    user.userId,
                    user.verified_email,
                )
            except Exception:
                # Another worker raced us; re-fetch.
                user = await UserRepository.get_by_id(SINGLE_USER_OWNER_ID)
                if user is None:
                    raise

        # Ensure is_setup_complete (the real OAuth bootstrap sets this; we
        # do it directly here so the frontend never sees setup_mode).
        if not user.is_setup_complete:
            updated = await UserRepository.update(
                user.userId,
                is_setup_complete=True,
            )
            if updated is not None:
                user = updated

        # Ensure the personal workspace + default env exist. Idempotent.
        await ensure_personal_workspace(user)

        _cached_owner = user
        return user


def invalidate_cache() -> None:
    """Drop the cached owner. Used by tests and by the destructive-reset
    flow (out of scope for this PR, but the seam is here)."""
    global _cached_owner
    _cached_owner = None
