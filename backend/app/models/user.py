from datetime import datetime

from beanie import Document
from pydantic import BaseModel, Field
from pymongo import ASCENDING, DESCENDING, IndexModel


class OAuthAccount(BaseModel):
    """
    Embedded OAuth provider account linked to a User.

    Stored directly on the User document for fast access — no JOIN needed
    to check whether a user has linked accounts.
    """

    provider: str  # "github" | "gitlab" | "microsoft" | "google" | "local"
    providerSubject: str  # Provider-issued unique subject ID
    linkedAt: datetime  # When the account was linked
    emailVerified: bool = True  # Always True — unverified emails rejected at intake


class User(Document):
    """
    Authenticated human user.

    verified_email is the canonical linking key — only verified provider emails
    are stored here. Raw OAuth tokens are never persisted.
    """

    userId: str
    verified_email: str
    display_name: str | None = None
    avatar_url: str | None = None
    roles: list[str] = Field(default_factory=list)  # e.g. ["admin"]
    permissions: list[str] = Field(default_factory=list)  # e.g. ["collections:write"]
    oauth_accounts: list[OAuthAccount] = Field(default_factory=list)
    is_setup_complete: bool = False
    created_at: datetime
    updated_at: datetime

    class Settings:
        name = "users"
        indexes = [
            IndexModel([("userId", ASCENDING)], unique=True),
            IndexModel([("verified_email", ASCENDING)], unique=True),
            IndexModel([("created_at", DESCENDING)]),
            IndexModel(
                [
                    ("oauth_accounts.provider", ASCENDING),
                    ("oauth_accounts.providerSubject", ASCENDING),
                ],
                unique=True,
                partialFilterExpression={
                    "oauth_accounts.0": {"$exists": True},
                },
            ),
        ]


class DeletedUser(Document):
    """Blocklist for deleted users to prevent re-creation via OAuth."""

    userId: str
    verified_email: str
    deleted_at: datetime

    class Settings:
        name = "deleted_users"
        indexes = [
            IndexModel([("userId", ASCENDING)], unique=True),
            IndexModel([("verified_email", ASCENDING)], unique=True),
        ]


class ProviderIdentity(Document):
    """
    OAuth provider identity linked to a User.

    Compound unique index on (provider, subject) prevents duplicate logins
    from the same provider account. Only verified emails are stored.
    """

    identityId: str
    userId: str  # str reference to User.userId
    provider: str  # "github" | "gitlab" | "microsoft" | "google"
    subject: str  # Provider-issued unique subject ID
    email: str  # Verified email from provider
    verified: bool = True  # Always True — unverified emails are rejected at intake

    class Settings:
        name = "provider_identities"
        indexes = [
            IndexModel([("identityId", ASCENDING)], unique=True),
            IndexModel([("provider", ASCENDING), ("subject", ASCENDING)], unique=True),
            IndexModel([("userId", ASCENDING)]),
            IndexModel([("email", ASCENDING)]),
        ]


class Session(Document):
    """
    Server-side session for an authenticated user.

    expires_at carries a TTL index so MongoDB auto-deletes expired sessions.
    last_seen_at is updated on each request for idle-timeout enforcement.
    """

    sessionId: str
    userId: str  # str reference to User.userId
    token_hash: str  # SHA-256 hash of the opaque session token — raw token never stored
    created_at: datetime
    last_seen_at: datetime
    expires_at: datetime  # Absolute expiry (7d); TTL index on this field
    revoked: bool = False

    class Settings:
        name = "sessions"
        indexes = [
            IndexModel([("sessionId", ASCENDING)], unique=True),
            IndexModel([("token_hash", ASCENDING)], unique=True),
            IndexModel([("userId", ASCENDING)]),
            IndexModel([("expires_at", ASCENDING)], expireAfterSeconds=0),  # TTL
        ]


class Invite(Document):
    """
    Email invitation to join APIWeave.

    token_hash stores a bcrypt/sha256 hash of the one-time invite token.
    The raw token is shown once and never persisted.
    expires_at carries a TTL index for automatic cleanup.
    """

    inviteId: str
    email: str
    token_hash: str  # Hash of one-time token — raw token never stored
    role_preset: str  # "viewer" | "editor" | "admin"
    created_by: str  # userId of inviting admin
    created_at: datetime
    expires_at: datetime  # TTL index on this field
    consumed_at: datetime | None = None
    consumed: bool = False
    invite_url: str | None = None

    class Settings:
        name = "invites"
        indexes = [
            IndexModel([("inviteId", ASCENDING)], unique=True),
            IndexModel([("email", ASCENDING)]),
            IndexModel([("expires_at", ASCENDING)], expireAfterSeconds=0),  # TTL
        ]


class ApprovedDomain(Document):
    """
    Email domain approved for self-signup SSO.

    Users whose verified provider email matches an approved domain can
    register without an explicit invite.
    """

    domainId: str
    domain: str  # e.g. "example.com"
    created_by: str  # userId of admin who approved the domain
    created_at: datetime

    class Settings:
        name = "approved_domains"
        indexes = [
            IndexModel([("domainId", ASCENDING)], unique=True),
            IndexModel([("domain", ASCENDING)], unique=True),
        ]


class OAuthState(Document):
    """
    Short-lived OAuth state for CSRF protection and PKCE.

    Stores the state parameter, PKCE code_verifier, and OIDC nonce for the
    duration of the OAuth redirect flow. expires_at TTL index auto-deletes
    stale states (typically after 10 minutes).
    """

    stateId: str
    state: str  # Random state parameter sent to provider
    code_verifier: str  # PKCE code_verifier (S256 challenge sent to provider)
    nonce: str  # OIDC nonce for ID token validation
    provider: str  # "github" | "gitlab" | "microsoft" | "google"
    redirect_uri: str | None = None
    invite_token: str | None = None
    expires_at: datetime  # TTL index — typically now + 10 minutes

    class Settings:
        name = "oauth_states"
        indexes = [
            IndexModel([("stateId", ASCENDING)], unique=True),
            IndexModel([("state", ASCENDING)], unique=True),
            IndexModel([("expires_at", ASCENDING)], expireAfterSeconds=0),  # TTL
        ]


class UserResponse(BaseModel):
    """
    Public user representation.

    Does NOT include internal fields. Safe to return in API responses.
    """

    userId: str
    verified_email: str
    display_name: str | None = None
    avatar_url: str | None = None
    roles: list[str] = Field(default_factory=list)
    permissions: list[str] = Field(default_factory=list)
    oauth_accounts: list[OAuthAccount] = Field(default_factory=list)
    is_setup_complete: bool
    created_at: datetime


class SessionResponse(BaseModel):
    """
    Session metadata returned after login.

    Does NOT include any raw session token — the token is delivered via
    HttpOnly cookie only and never echoed in the response body.
    """

    sessionId: str
    userId: str
    created_at: datetime
    expires_at: datetime
    last_seen_at: datetime


class InviteResponse(BaseModel):
    """
    Invite metadata returned to admins.

    token_hash is intentionally excluded. The invite URL (containing the
    one-time token) is included only at creation time via a separate
    one-time response shape.
    """

    inviteId: str
    email: str
    role_preset: str
    created_by: str
    created_at: datetime
    expires_at: datetime
    consumed: bool
    consumed_at: datetime | None = None
    invite_url: str | None = None
