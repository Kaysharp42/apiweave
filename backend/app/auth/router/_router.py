"""Shared :class:`~fastapi.APIRouter` and module-level constants.

Every route submodule imports ``router`` from here so that all routes are
registered on the same instance.  The package ``__init__`` re-exports it.
"""

from __future__ import annotations

from fastapi import APIRouter

router = APIRouter(prefix="/api/auth", tags=["auth"])

SESSION_COOKIE_NAME = "session"
CSRF_COOKIE_NAME = "csrftoken"
SESSION_MAX_AGE_SECONDS = 604800
