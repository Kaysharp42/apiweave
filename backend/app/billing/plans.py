"""Plan catalog — the single source of truth for what each tier grants.

Phase 4 billing. `entitlements.py` reads these limits via the resolver; nothing
else hardcodes a plan limit. Free-tier numbers are product-specified; paid
numbers are industry-standard defaults — tune here, not at call sites.

Billing subject is dual: free/individual attach to a USER, team/enterprise to
an ORG (see entitlement_resolver). When BILLING_ENABLED is false the resolver
returns UNLIMITED, so self-hosters are never capped.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Plan:
    key: str
    name: str
    # Capabilities
    can_create_orgs: bool
    can_create_projects: bool
    can_rerun_from_failed: bool
    persist_run_history: bool  # False ⇒ only the last run is kept per workflow
    persist_webhook_logs: bool
    # Limits (None = unlimited)
    run_history_retention_days: int | None
    webhook_log_retention_days: int | None
    webhook_runs_per_day: int | None
    max_seats: int | None


FREE = Plan(
    key="free",
    name="Free",
    can_create_orgs=False,
    can_create_projects=False,
    can_rerun_from_failed=False,
    persist_run_history=False,  # last run only
    persist_webhook_logs=False,
    run_history_retention_days=None,
    webhook_log_retention_days=None,
    webhook_runs_per_day=5,
    max_seats=1,
)

INDIVIDUAL = Plan(
    key="individual",
    name="Individual",
    can_create_orgs=False,  # orgs/teams are a Teams-tier feature
    can_create_projects=True,
    can_rerun_from_failed=True,
    persist_run_history=True,
    persist_webhook_logs=True,
    run_history_retention_days=90,
    webhook_log_retention_days=30,
    webhook_runs_per_day=500,
    max_seats=1,
)

TEAM = Plan(
    key="team",
    name="Teams",
    can_create_orgs=True,
    can_create_projects=True,
    can_rerun_from_failed=True,
    persist_run_history=True,
    persist_webhook_logs=True,
    run_history_retention_days=90,
    webhook_log_retention_days=90,
    webhook_runs_per_day=5000,
    max_seats=100,
)

ENTERPRISE = Plan(
    key="enterprise",
    name="Enterprise",
    can_create_orgs=True,
    can_create_projects=True,
    can_rerun_from_failed=True,
    persist_run_history=True,
    persist_webhook_logs=True,
    run_history_retention_days=None,
    webhook_log_retention_days=None,
    webhook_runs_per_day=None,
    max_seats=None,
)

# Synthetic plan used when billing is disabled (self-host): no caps at all.
UNLIMITED = Plan(
    key="unlimited",
    name="Unlimited (self-host)",
    can_create_orgs=True,
    can_create_projects=True,
    can_rerun_from_failed=True,
    persist_run_history=True,
    persist_webhook_logs=True,
    run_history_retention_days=None,
    webhook_log_retention_days=None,
    webhook_runs_per_day=None,
    max_seats=None,
)

# Purchasable plans, keyed by the value stored on Subscription.plan / Organization.plan.
PLAN_BY_KEY: dict[str, Plan] = {
    FREE.key: FREE,
    INDIVIDUAL.key: INDIVIDUAL,
    TEAM.key: TEAM,
    ENTERPRISE.key: ENTERPRISE,
}
