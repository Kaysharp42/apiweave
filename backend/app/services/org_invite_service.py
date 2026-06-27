"""
Organization invite service — GitHub-like org-scoped invites.

7-day expiry, rate-limited per org (max 10 invites per org per 24h),
token shown once at creation. Accepting an invite adds the user as
an org member with the invited role.
"""

from __future__ import annotations

import hashlib
import logging
import secrets
import uuid
from datetime import UTC, datetime, timedelta

from fastapi import HTTPException, status

from app.auth.permissions import OrgRole
from app.models import (
    OrgInviteCreateResponse,
    OrgInviteResponse,
    User,
)
from app.repositories.org_invite_repository import OrgInviteRepository
from app.repositories.organization_repository import OrganizationRepository
from app.services.audit_service import append_event
from app.services.org_service import require_org_member

logger = logging.getLogger(__name__)

INVITE_EXPIRY_DAYS = 7
RATE_LIMIT_WINDOW_HOURS = 24
RATE_LIMIT_MAX_INVITES = 10

VALID_INVITE_ROLES = {OrgRole.MEMBER, OrgRole.BILLING, OrgRole.SECURITY}


def _hash_token(raw_token: str) -> str:
    return hashlib.sha256(raw_token.encode("utf-8")).hexdigest()


async def create_org_invite(
    org_id: str,
    *,
    email: str,
    role: str,
    actor: User,
) -> OrgInviteCreateResponse:
    await require_org_member(org_id, actor.userId)

    member = await OrganizationRepository.get_member(org_id, actor.userId)
    if member and member.role not in {OrgRole.OWNER, OrgRole.MEMBER}:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only owners or members can invite",
        )

    normalized_email = email.lower().strip()

    try_role = OrgRole(role)
    if try_role not in VALID_INVITE_ROLES:
        valid_roles = [r.value for r in VALID_INVITE_ROLES]
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Invalid invite role: {role}. Must be one of: {valid_roles}",
        )

    existing_member = await OrganizationRepository.get_member(org_id, normalized_email)
    if existing_member:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="User with this email is already a member",
        )

    active_invite = await OrgInviteRepository.find_active_by_org_and_email(org_id, normalized_email)
    if active_invite:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An active invite already exists for this email",
        )

    since = datetime.now(UTC) - timedelta(hours=RATE_LIMIT_WINDOW_HOURS)
    recent_count = await OrgInviteRepository.count_recent_by_org(org_id, since)
    if recent_count >= RATE_LIMIT_MAX_INVITES:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=(
                f"Rate limit: max {RATE_LIMIT_MAX_INVITES} invites "
                f"per {RATE_LIMIT_WINDOW_HOURS}h"
            ),
        )

    raw_token = secrets.token_urlsafe(32)
    token_hash = _hash_token(raw_token)
    now = datetime.now(UTC)
    expires_at = now + timedelta(days=INVITE_EXPIRY_DAYS)

    invite = await OrgInviteRepository.create(
        invite_id=f"oi-{uuid.uuid4().hex[:12]}",
        org_id=org_id,
        email=normalized_email,
        token_hash=token_hash,
        role=role,
        invited_by=actor.userId,
        expires_at=expires_at,
    )

    await append_event(
        actor="user",
        actor_id=actor.userId,
        action="org.invite.created",
        scope="org",
        scope_id=org_id,
        resource_type="org_invite",
        resource_id=invite.inviteId,
        context={"email": normalized_email, "role": role},
    )

    # Deliver as a magic link (org invite = magic link): clicking it signs the
    # invitee in and auto-accepts. Best-effort — never fail invite creation on a
    # mail error, and no-op when EMAIL_LOGIN is off / SMTP unconfigured.
    try:
        org = await OrganizationRepository.get_by_id(org_id)
        from app.services import email_auth_service

        await email_auth_service.send_org_invite_link(
            normalized_email, org.name if org else "the organization"
        )
    except Exception:
        logger.warning("Failed to send org-invite email for %s", normalized_email, exc_info=True)

    return OrgInviteCreateResponse(
        inviteId=invite.inviteId,
        orgId=org_id,
        email=normalized_email,
        role=role,
        token=raw_token,
        expires_at=expires_at,
    )


async def resend_org_invite(
    org_id: str,
    invite_id: str,
    *,
    actor: User,
) -> OrgInviteCreateResponse:
    """Resend a pending org invite by rotating its token.

    Implemented as cancel-old + create-new so it reuses create_org_invite's
    validation (rate limit, role checks, audit) and returns a fresh raw token
    for the UI to surface (and for SMTP delivery once wired). The old token is
    invalidated. Owner authorization is enforced at the route.
    """
    await require_org_member(org_id, actor.userId)

    invite = await OrgInviteRepository.get_by_id(invite_id)
    if not invite or invite.orgId != org_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Invite not found")
    if invite.consumed:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Invite has already been accepted and cannot be resent",
        )

    email = invite.email
    role = invite.role
    # Remove the old invite so create_org_invite's active-invite guard passes
    # and the old token is invalidated.
    await OrgInviteRepository.cancel(invite_id)

    await append_event(
        actor="user",
        actor_id=actor.userId,
        action="org.invite.resent",
        scope="org",
        scope_id=org_id,
        resource_type="org_invite",
        resource_id=invite_id,
        context={"email": email},
    )

    return await create_org_invite(org_id, email=email, role=role, actor=actor)


async def accept_pending_invites_for_user(user: User) -> int:
    """Accept all active org invites addressed to the user's verified email.

    Used by the magic-link sign-in flow: clicking the emailed link proves
    ownership of the invited address, so any pending org invite(s) for that
    email are accepted (the user is added to each org). Idempotent — already-a-
    member orgs are skipped. Returns the number of invites accepted.
    """
    email = user.verified_email.lower()
    invites = await OrgInviteRepository.list_active_by_email(email)
    accepted = 0
    for invite in invites:
        existing = await OrganizationRepository.get_member(invite.orgId, user.userId)
        if existing is None:
            await OrganizationRepository.add_member(
                member_id=f"om-{uuid.uuid4().hex[:12]}",
                org_id=invite.orgId,
                user_id=user.userId,
                role=invite.role,
            )
            accepted += 1
        await OrgInviteRepository.consume(invite.inviteId)
        await append_event(
            actor="user",
            actor_id=user.userId,
            action="org.invite.accepted",
            scope="org",
            scope_id=invite.orgId,
            resource_type="org_invite",
            resource_id=invite.inviteId,
            context={"email": email, "role": invite.role, "via": "magic_link"},
        )
    return accepted


async def list_org_invites(org_id: str) -> list[OrgInviteResponse]:
    invites = await OrgInviteRepository.list_pending_by_org(org_id)
    return [OrgInviteResponse.model_validate(i) for i in invites]


async def cancel_org_invite(
    org_id: str,
    invite_id: str,
    *,
    actor: User,
) -> dict[str, str]:
    await require_org_member(org_id, actor.userId)

    invite = await OrgInviteRepository.get_by_id(invite_id)
    if not invite or invite.orgId != org_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Invite not found")

    await OrgInviteRepository.cancel(invite_id)

    await append_event(
        actor="user",
        actor_id=actor.userId,
        action="org.invite.cancelled",
        scope="org",
        scope_id=org_id,
        resource_type="org_invite",
        resource_id=invite_id,
        context={"email": invite.email},
    )

    return {"status": "cancelled", "inviteId": invite_id}


async def accept_org_invite(
    token: str,
    accepting_user: User,
) -> OrgInviteResponse:
    token_hash = _hash_token(token)
    invite = await OrgInviteRepository.get_by_token_hash(token_hash)
    if not invite:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Invite not found")

    if invite.consumed:
        raise HTTPException(status_code=status.HTTP_410_GONE, detail="Invite already consumed")

    now = datetime.now(UTC)
    expires_at = invite.expires_at
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=UTC)
    if now >= expires_at:
        raise HTTPException(status_code=status.HTTP_410_GONE, detail="Invite expired")

    if invite.email != accepting_user.verified_email.lower():
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invite email does not match your account email",
        )

    existing_member = await OrganizationRepository.get_member(invite.orgId, accepting_user.userId)
    if existing_member:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Already a member of this organization",
        )

    await OrganizationRepository.add_member(
        member_id=f"om-{uuid.uuid4().hex[:12]}",
        org_id=invite.orgId,
        user_id=accepting_user.userId,
        role=invite.role,
    )

    await OrgInviteRepository.consume(invite.inviteId)

    await append_event(
        actor="user",
        actor_id=accepting_user.userId,
        action="org.invite.accepted",
        scope="org",
        scope_id=invite.orgId,
        resource_type="org_invite",
        resource_id=invite.inviteId,
        context={"email": invite.email, "role": invite.role},
    )

    consumed_invite = await OrgInviteRepository.get_by_id(invite.inviteId)
    return OrgInviteResponse.model_validate(consumed_invite or invite)
