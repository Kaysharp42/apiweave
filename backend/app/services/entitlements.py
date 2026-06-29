"""Single chokepoint for billing entitlements.

Today every check passes when ``BILLING_ENABLED`` is False (the default), so
orgs, workspaces, and invites are unrestricted — "everyone can create" per the
current product decision. When billing lands (Phase 4), plan/seat/quota
enforcement goes HERE and nowhere else: call sites already invoke these
functions, so no refactor is needed. Denials raise 402 Payment Required.

ponytail: intentionally allow-all placeholders — this is the seam, not the
policy. Phase 4 (P4.3 seats, P4.4 quotas) fills the bodies below the flag check.
"""

from __future__ import annotations

from fastapi import HTTPException, status

from app.config import settings
from app.models import User


def deny(detail: str) -> None:
    """Raise the canonical paywall error. Used by Phase 4 policy bodies."""
    raise HTTPException(status_code=status.HTTP_402_PAYMENT_REQUIRED, detail=detail)


async def require_can_create_org(user: User) -> None:
    """A user may create a new organization."""
    if not settings.BILLING_ENABLED:
        return
    # Phase 4: e.g. cap free-plan users to N orgs, or require a paid plan.
    return


async def require_can_create_workspace(*, actor_user_id: str, org_id: str | None) -> None:
    """A user may create a workspace (personal when org_id is None, else org-owned)."""
    if not settings.BILLING_ENABLED:
        return
    # Phase 4: enforce per-org workspace quota against the org's plan.
    return


async def require_can_add_org_member(org_id: str) -> None:
    """An org may gain another member (invite or direct add) — i.e. has a seat."""
    if not settings.BILLING_ENABLED:
        return
    # Phase 4: count members against the org plan's seat limit; deny() if full.
    return
