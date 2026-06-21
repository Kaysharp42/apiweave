from datetime import datetime

from beanie import Document
from pydantic import BaseModel, ConfigDict
from pymongo import ASCENDING, IndexModel


class OrgInvite(Document):
    """
    Organization-scoped invitation.

    Distinct from the platform-level Invite model. Org invites grant membership
    in a specific organization with a specific role. 7-day expiry, rate-limited
    per org per email, token shown once.
    """

    inviteId: str
    orgId: str
    email: str
    token_hash: str
    role: str  # OrgMemberRole value
    invited_by: str  # userId of the inviter
    created_at: datetime
    expires_at: datetime
    consumed_at: datetime | None = None
    consumed: bool = False

    class Settings:
        name = "org_invites"
        indexes = [
            IndexModel([("inviteId", ASCENDING)], unique=True),
            IndexModel([("orgId", ASCENDING), ("email", ASCENDING)]),
            IndexModel([("token_hash", ASCENDING)], unique=True),
            IndexModel([("expires_at", ASCENDING)], expireAfterSeconds=0),
        ]


class OrgInviteResponse(BaseModel):
    """Organization invite representation (no token_hash)."""

    model_config = ConfigDict(from_attributes=True)

    inviteId: str
    orgId: str
    email: str
    role: str
    invited_by: str
    created_at: datetime
    expires_at: datetime
    consumed: bool
    consumed_at: datetime | None = None


class OrgInviteCreateResponse(BaseModel):
    """Response at invite creation time — includes the one-time token."""

    inviteId: str
    orgId: str
    email: str
    role: str
    token: str  # One-time raw token — shown only at creation
    expires_at: datetime
