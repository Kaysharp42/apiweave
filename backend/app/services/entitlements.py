"""Single chokepoint for billing entitlements.

When ``BILLING_ENABLED`` is False (the default, and always for self-host), the
resolver returns the UNLIMITED plan so every check passes — "everyone can
create". When billing is on, each gate consults the active plan for the billing
subject (a user for free/individual, an org for team/enterprise) via the
resolver, and raises 402 Payment Required when the plan disallows the action.

This is the ONLY place plan/capability/seat logic is enforced; call sites just
invoke these functions. Numeric limits live in app/billing/plans.py.
"""

from __future__ import annotations

from fastapi import HTTPException, status

from app.billing.entitlement_resolver import resolve_plan, resolve_plan_for_workspace
from app.models import User
from app.repositories.organization_repository import OrganizationRepository

_UPGRADE_HINT = "Upgrade your plan to do this."


def deny(detail: str) -> None:
    """Raise the canonical paywall error."""
    raise HTTPException(status_code=status.HTTP_402_PAYMENT_REQUIRED, detail=detail)


async def require_can_create_org(user: User) -> None:
    """Creating an organization (Teams feature) requires a plan that allows orgs.

    ponytail: with checkout-first (P4.2), the org is created by the Stripe webhook
    once the buyer's Team subscription exists; that path resolves to a plan with
    can_create_orgs=True, so this gate passes there and blocks the bare UI path."""
    plan = await resolve_plan("user", user.userId)
    if not plan.can_create_orgs:
        deny("Creating an organization requires a Teams plan. " + _UPGRADE_HINT)


async def require_can_create_workspace(*, actor_user_id: str, org_id: str | None) -> None:
    """Personal workspaces are allowed on every plan. Org-owned workspaces
    require the org to be on a plan that supports organizations."""
    if org_id is None:
        return  # personal workspace — always allowed
    plan = await resolve_plan("organization", org_id)
    if not plan.can_create_orgs:
        deny("Team workspaces require a Teams plan. " + _UPGRADE_HINT)


async def require_can_create_project(workspace_id: str) -> None:
    """Projects are a paid feature (Free has none)."""
    plan = await resolve_plan_for_workspace(workspace_id)
    if not plan.can_create_projects:
        deny("Projects require a paid plan. " + _UPGRADE_HINT)


async def require_can_rerun_from_failed(workspace_id: str) -> None:
    """Re-running from the last failed node is a paid feature."""
    plan = await resolve_plan_for_workspace(workspace_id)
    if not plan.can_rerun_from_failed:
        deny("Re-running from the last failed node requires a paid plan. " + _UPGRADE_HINT)


async def require_can_add_org_member(org_id: str) -> None:
    """An org may gain another member only if it has a free seat under its plan."""
    plan = await resolve_plan("organization", org_id)
    if plan.max_seats is None:
        return  # unlimited
    current = await OrganizationRepository.count_members(org_id)
    if current >= plan.max_seats:
        deny(
            f"Your plan allows up to {plan.max_seats} members. " + _UPGRADE_HINT,
        )
