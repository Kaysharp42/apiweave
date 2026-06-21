"""Provider-list and deployment-mode routes."""

from __future__ import annotations

from app.auth.provider_registry import get_configured_providers
from app.config import settings

from ._router import router


@router.get("/providers")
def list_providers() -> list[dict]:
    """Return enabled status for all known OAuth providers. Public — no auth required."""
    return get_configured_providers()


@router.get("/mode")
def deployment_mode() -> dict[str, str]:
    """Return the current deployment mode. Public — no auth required.

    The frontend reads this on boot to decide whether to render the
    login/setup pages and the multi-tenant org UI.
    """
    return {"mode": settings.DEPLOYMENT_MODE}
