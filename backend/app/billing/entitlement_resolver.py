"""Resolve the active Plan for a billing subject (Phase 4).

Subject is dual: "user" (free/individual) or "organization" (team/enterprise).
- BILLING_ENABLED off (self-host): everything is UNLIMITED.
- A user with no/inactive subscription: FREE.
- An org with no/inactive subscription: FREE (restricted) — an org should only
  exist with a paid plan; a sub-less org is treated as the most limited tier
  until P4.2's checkout-first flow attaches its Team/Enterprise subscription.
"""

from __future__ import annotations

from app.billing.plans import FREE, PLAN_BY_KEY, UNLIMITED, Plan
from app.config import settings
from app.repositories.subscription_repository import SubscriptionRepository

_ACTIVE_STATUSES = {"active", "trialing"}


async def resolve_plan(owner_type: str, owner_id: str) -> Plan:
    if not settings.BILLING_ENABLED:
        return UNLIMITED

    sub = await SubscriptionRepository.get_for(owner_type, owner_id)
    if sub is not None and sub.status in _ACTIVE_STATUSES:
        return PLAN_BY_KEY.get(sub.plan, FREE)
    return FREE
