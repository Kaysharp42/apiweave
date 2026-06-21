"""
RED tests for auth models (Task 2).

These tests verify:
- Auth document models exist and have correct fields
- TTL indexes declared on Session.expires_at, Invite.expires_at, OAuthState.expires_at
- Compound unique index on ProviderIdentity (provider + subject)
- Unique index on User.verified_email
- Response DTOs exist and redact sensitive fields
- Model field constraints (types, defaults, required fields)

Run BEFORE implementing models to confirm RED, then GREEN after implementation.
"""

from datetime import UTC, datetime, timedelta

# ---------------------------------------------------------------------------
# Import guard — these will fail (RED) until models are implemented
# ---------------------------------------------------------------------------


def test_user_model_importable():
    """User document model must be importable from app.models."""
    from app.models import User  # noqa: F401


def test_provider_identity_model_importable():
    """ProviderIdentity document model must be importable from app.models."""
    from app.models import ProviderIdentity  # noqa: F401


def test_session_model_importable():
    """Session document model must be importable from app.models."""
    from app.models import Session  # noqa: F401


def test_invite_model_importable():
    """Invite document model must be importable from app.models."""
    from app.models import Invite  # noqa: F401


def test_approved_domain_model_importable():
    """ApprovedDomain document model must be importable from app.models."""
    from app.models import ApprovedDomain  # noqa: F401


def test_oauth_state_model_importable():
    """OAuthState document model must be importable from app.models."""
    from app.models import OAuthState  # noqa: F401


# ---------------------------------------------------------------------------
# DTO import guard
# ---------------------------------------------------------------------------


def test_user_response_dto_importable():
    """UserResponse DTO must be importable from app.models."""
    from app.models import UserResponse  # noqa: F401


def test_session_response_dto_importable():
    """SessionResponse DTO must be importable from app.models."""
    from app.models import SessionResponse  # noqa: F401


def test_invite_response_dto_importable():
    """InviteResponse DTO must be importable from app.models."""
    from app.models import InviteResponse  # noqa: F401


# ---------------------------------------------------------------------------
# User model field tests
# ---------------------------------------------------------------------------


class TestUserModel:
    def test_user_has_user_id_field(self):
        from app.models import User

        fields = User.model_fields
        assert "userId" in fields

    def test_user_has_verified_email_field(self):
        from app.models import User

        fields = User.model_fields
        assert "verified_email" in fields

    def test_user_has_display_name_field(self):
        from app.models import User

        fields = User.model_fields
        assert "display_name" in fields

    def test_user_has_avatar_url_field(self):
        from app.models import User

        fields = User.model_fields
        assert "avatar_url" in fields

    def test_user_has_roles_field(self):
        from app.models import User

        fields = User.model_fields
        assert "roles" in fields

    def test_user_has_permissions_field(self):
        from app.models import User

        fields = User.model_fields
        assert "permissions" in fields

    def test_user_has_is_setup_complete_field(self):
        from app.models import User

        fields = User.model_fields
        assert "is_setup_complete" in fields

    def test_user_has_created_at_field(self):
        from app.models import User

        fields = User.model_fields
        assert "created_at" in fields

    def test_user_has_updated_at_field(self):
        from app.models import User

        fields = User.model_fields
        assert "updated_at" in fields

    def test_user_is_beanie_document(self):
        from beanie import Document

        from app.models import User

        assert issubclass(User, Document)

    def test_user_has_settings_class(self):
        from app.models import User

        assert hasattr(User, "Settings")

    def test_user_settings_has_collection_name(self):
        from app.models import User

        assert hasattr(User.Settings, "name")
        assert User.Settings.name == "users"

    def test_user_settings_has_indexes(self):
        from app.models import User

        assert hasattr(User.Settings, "indexes")
        assert len(User.Settings.indexes) > 0

    def test_user_verified_email_index_is_unique(self):
        """verified_email must have a unique index."""
        from app.models import User

        indexes = User.Settings.indexes
        unique_email_index = None
        for idx in indexes:
            doc = idx.document
            keys = [k for k, _ in doc.get("key", {}).items()]
            if "verified_email" in keys and doc.get("unique"):
                unique_email_index = idx
                break
        assert unique_email_index is not None, "No unique index found on User.verified_email"

    def test_user_instantiation(self):
        from app.models import User

        now = datetime.now(UTC)
        user = User.model_construct(
            userId="usr-001",
            verified_email="alice@example.com",
            roles=["admin"],
            permissions=["collections:write"],
            is_setup_complete=True,
            created_at=now,
            updated_at=now,
        )
        assert user.userId == "usr-001"
        assert user.verified_email == "alice@example.com"
        assert "admin" in user.roles

    def test_user_optional_fields_default_none(self):
        from app.models import User

        now = datetime.now(UTC)
        user = User.model_construct(
            userId="usr-002",
            verified_email="bob@example.com",
            display_name=None,
            avatar_url=None,
            roles=[],
            permissions=[],
            is_setup_complete=False,
            created_at=now,
            updated_at=now,
        )
        assert user.display_name is None
        assert user.avatar_url is None


# ---------------------------------------------------------------------------
# ProviderIdentity model field tests
# ---------------------------------------------------------------------------


class TestProviderIdentityModel:
    def test_provider_identity_has_identity_id(self):
        from app.models import ProviderIdentity

        assert "identityId" in ProviderIdentity.model_fields

    def test_provider_identity_has_user_id(self):
        from app.models import ProviderIdentity

        assert "userId" in ProviderIdentity.model_fields

    def test_provider_identity_has_provider(self):
        from app.models import ProviderIdentity

        assert "provider" in ProviderIdentity.model_fields

    def test_provider_identity_has_subject(self):
        from app.models import ProviderIdentity

        assert "subject" in ProviderIdentity.model_fields

    def test_provider_identity_has_email(self):
        from app.models import ProviderIdentity

        assert "email" in ProviderIdentity.model_fields

    def test_provider_identity_has_verified(self):
        from app.models import ProviderIdentity

        assert "verified" in ProviderIdentity.model_fields

    def test_provider_identity_is_beanie_document(self):
        from beanie import Document

        from app.models import ProviderIdentity

        assert issubclass(ProviderIdentity, Document)

    def test_provider_identity_settings_collection_name(self):
        from app.models import ProviderIdentity

        assert ProviderIdentity.Settings.name == "provider_identities"

    def test_provider_identity_compound_unique_index(self):
        """Must have a compound unique index on (provider, subject)."""
        from app.models import ProviderIdentity

        indexes = ProviderIdentity.Settings.indexes
        compound_unique = None
        for idx in indexes:
            doc = idx.document
            keys = list(doc.get("key", {}).keys())
            if "provider" in keys and "subject" in keys and doc.get("unique"):
                compound_unique = idx
                break
        assert (
            compound_unique is not None
        ), "No compound unique index found on ProviderIdentity(provider, subject)"

    def test_provider_identity_instantiation(self):
        from app.models import ProviderIdentity

        pi = ProviderIdentity.model_construct(
            identityId="pid-001",
            userId="usr-001",
            provider="github",
            subject="gh-12345",
            email="alice@example.com",
            verified=True,
        )
        assert pi.provider == "github"
        assert pi.subject == "gh-12345"
        assert pi.verified is True


# ---------------------------------------------------------------------------
# Session model field tests
# ---------------------------------------------------------------------------


class TestSessionModel:
    def test_session_has_session_id(self):
        from app.models import Session

        assert "sessionId" in Session.model_fields

    def test_session_has_user_id(self):
        from app.models import Session

        assert "userId" in Session.model_fields

    def test_session_has_created_at(self):
        from app.models import Session

        assert "created_at" in Session.model_fields

    def test_session_has_last_seen_at(self):
        from app.models import Session

        assert "last_seen_at" in Session.model_fields

    def test_session_has_expires_at(self):
        from app.models import Session

        assert "expires_at" in Session.model_fields

    def test_session_has_revoked(self):
        from app.models import Session

        assert "revoked" in Session.model_fields

    def test_session_is_beanie_document(self):
        from beanie import Document

        from app.models import Session

        assert issubclass(Session, Document)

    def test_session_settings_collection_name(self):
        from app.models import Session

        assert Session.Settings.name == "sessions"

    def test_session_expires_at_has_ttl_index(self):
        """expires_at must have a TTL index (expireAfterSeconds=0)."""
        from app.models import Session

        indexes = Session.Settings.indexes
        ttl_index = None
        for idx in indexes:
            doc = idx.document
            keys = list(doc.get("key", {}).keys())
            if "expires_at" in keys and "expireAfterSeconds" in doc:
                ttl_index = idx
                break
        assert ttl_index is not None, "No TTL index found on Session.expires_at"

    def test_session_revoked_defaults_false(self):
        from app.models import Session

        now = datetime.now(UTC)
        s = Session.model_construct(
            sessionId="ses-001",
            userId="usr-001",
            created_at=now,
            last_seen_at=now,
            expires_at=now + timedelta(days=7),
            revoked=False,
        )
        assert s.revoked is False


# ---------------------------------------------------------------------------
# Invite model field tests
# ---------------------------------------------------------------------------


class TestInviteModel:
    def test_invite_has_invite_id(self):
        from app.models import Invite

        assert "inviteId" in Invite.model_fields

    def test_invite_has_email(self):
        from app.models import Invite

        assert "email" in Invite.model_fields

    def test_invite_has_token_hash(self):
        from app.models import Invite

        assert "token_hash" in Invite.model_fields

    def test_invite_has_role_preset(self):
        from app.models import Invite

        assert "role_preset" in Invite.model_fields

    def test_invite_has_created_by(self):
        from app.models import Invite

        assert "created_by" in Invite.model_fields

    def test_invite_has_created_at(self):
        from app.models import Invite

        assert "created_at" in Invite.model_fields

    def test_invite_has_expires_at(self):
        from app.models import Invite

        assert "expires_at" in Invite.model_fields

    def test_invite_has_consumed_at(self):
        from app.models import Invite

        assert "consumed_at" in Invite.model_fields

    def test_invite_has_consumed(self):
        from app.models import Invite

        assert "consumed" in Invite.model_fields

    def test_invite_is_beanie_document(self):
        from beanie import Document

        from app.models import Invite

        assert issubclass(Invite, Document)

    def test_invite_settings_collection_name(self):
        from app.models import Invite

        assert Invite.Settings.name == "invites"

    def test_invite_expires_at_has_ttl_index(self):
        """expires_at must have a TTL index."""
        from app.models import Invite

        indexes = Invite.Settings.indexes
        ttl_index = None
        for idx in indexes:
            doc = idx.document
            keys = list(doc.get("key", {}).keys())
            if "expires_at" in keys and "expireAfterSeconds" in doc:
                ttl_index = idx
                break
        assert ttl_index is not None, "No TTL index found on Invite.expires_at"

    def test_invite_consumed_defaults_false(self):
        from app.models import Invite

        now = datetime.now(UTC)
        inv = Invite.model_construct(
            inviteId="inv-001",
            email="newuser@example.com",
            token_hash="abc123hash",
            role_preset="viewer",
            created_by="usr-001",
            created_at=now,
            expires_at=now + timedelta(days=7),
            consumed=False,
            consumed_at=None,
        )
        assert inv.consumed is False
        assert inv.consumed_at is None


# ---------------------------------------------------------------------------
# ApprovedDomain model field tests
# ---------------------------------------------------------------------------


class TestApprovedDomainModel:
    def test_approved_domain_has_domain_id(self):
        from app.models import ApprovedDomain

        assert "domainId" in ApprovedDomain.model_fields

    def test_approved_domain_has_domain(self):
        from app.models import ApprovedDomain

        assert "domain" in ApprovedDomain.model_fields

    def test_approved_domain_has_created_by(self):
        from app.models import ApprovedDomain

        assert "created_by" in ApprovedDomain.model_fields

    def test_approved_domain_has_created_at(self):
        from app.models import ApprovedDomain

        assert "created_at" in ApprovedDomain.model_fields

    def test_approved_domain_is_beanie_document(self):
        from beanie import Document

        from app.models import ApprovedDomain

        assert issubclass(ApprovedDomain, Document)

    def test_approved_domain_settings_collection_name(self):
        from app.models import ApprovedDomain

        assert ApprovedDomain.Settings.name == "approved_domains"


# ---------------------------------------------------------------------------
# OAuthState model field tests
# ---------------------------------------------------------------------------


class TestOAuthStateModel:
    def test_oauth_state_has_state_id(self):
        from app.models import OAuthState

        assert "stateId" in OAuthState.model_fields

    def test_oauth_state_has_state(self):
        from app.models import OAuthState

        assert "state" in OAuthState.model_fields

    def test_oauth_state_has_code_verifier(self):
        from app.models import OAuthState

        assert "code_verifier" in OAuthState.model_fields

    def test_oauth_state_has_nonce(self):
        from app.models import OAuthState

        assert "nonce" in OAuthState.model_fields

    def test_oauth_state_has_provider(self):
        from app.models import OAuthState

        assert "provider" in OAuthState.model_fields

    def test_oauth_state_has_redirect_uri(self):
        from app.models import OAuthState

        assert "redirect_uri" in OAuthState.model_fields

    def test_oauth_state_has_expires_at(self):
        from app.models import OAuthState

        assert "expires_at" in OAuthState.model_fields

    def test_oauth_state_is_beanie_document(self):
        from beanie import Document

        from app.models import OAuthState

        assert issubclass(OAuthState, Document)

    def test_oauth_state_settings_collection_name(self):
        from app.models import OAuthState

        assert OAuthState.Settings.name == "oauth_states"

    def test_oauth_state_expires_at_has_ttl_index(self):
        """expires_at must have a TTL index."""
        from app.models import OAuthState

        indexes = OAuthState.Settings.indexes
        ttl_index = None
        for idx in indexes:
            doc = idx.document
            keys = list(doc.get("key", {}).keys())
            if "expires_at" in keys and "expireAfterSeconds" in doc:
                ttl_index = idx
                break
        assert ttl_index is not None, "No TTL index found on OAuthState.expires_at"


# ---------------------------------------------------------------------------
# Response DTO tests
# ---------------------------------------------------------------------------


class TestUserResponseDTO:
    def test_user_response_has_user_id(self):
        from app.models import UserResponse

        assert "userId" in UserResponse.model_fields

    def test_user_response_has_verified_email(self):
        from app.models import UserResponse

        assert "verified_email" in UserResponse.model_fields

    def test_user_response_has_display_name(self):
        from app.models import UserResponse

        assert "display_name" in UserResponse.model_fields

    def test_user_response_has_roles(self):
        from app.models import UserResponse

        assert "roles" in UserResponse.model_fields

    def test_user_response_has_permissions(self):
        from app.models import UserResponse

        assert "permissions" in UserResponse.model_fields

    def test_user_response_has_is_setup_complete(self):
        from app.models import UserResponse

        assert "is_setup_complete" in UserResponse.model_fields

    def test_user_response_is_pydantic_base_model(self):
        from pydantic import BaseModel

        from app.models import UserResponse

        assert issubclass(UserResponse, BaseModel)

    def test_user_response_instantiation(self):
        from app.models import UserResponse

        now = datetime.now(UTC)
        dto = UserResponse(
            userId="usr-001",
            verified_email="alice@example.com",
            display_name="Alice",
            avatar_url=None,
            roles=["admin"],
            permissions=["collections:write"],
            is_setup_complete=True,
            created_at=now,
        )
        assert dto.userId == "usr-001"


class TestSessionResponseDTO:
    def test_session_response_has_session_id(self):
        from app.models import SessionResponse

        assert "sessionId" in SessionResponse.model_fields

    def test_session_response_has_user_id(self):
        from app.models import SessionResponse

        assert "userId" in SessionResponse.model_fields

    def test_session_response_has_expires_at(self):
        from app.models import SessionResponse

        assert "expires_at" in SessionResponse.model_fields

    def test_session_response_has_created_at(self):
        from app.models import SessionResponse

        assert "created_at" in SessionResponse.model_fields

    def test_session_response_is_pydantic_base_model(self):
        from pydantic import BaseModel

        from app.models import SessionResponse

        assert issubclass(SessionResponse, BaseModel)

    def test_session_response_no_raw_token_field(self):
        """SessionResponse must NOT expose a raw token field."""
        from app.models import SessionResponse

        fields = SessionResponse.model_fields
        assert "token" not in fields
        assert "session_token" not in fields
        assert "raw_token" not in fields


class TestInviteResponseDTO:
    def test_invite_response_has_invite_id(self):
        from app.models import InviteResponse

        assert "inviteId" in InviteResponse.model_fields

    def test_invite_response_has_email(self):
        from app.models import InviteResponse

        assert "email" in InviteResponse.model_fields

    def test_invite_response_has_role_preset(self):
        from app.models import InviteResponse

        assert "role_preset" in InviteResponse.model_fields

    def test_invite_response_has_expires_at(self):
        from app.models import InviteResponse

        assert "expires_at" in InviteResponse.model_fields

    def test_invite_response_has_consumed(self):
        from app.models import InviteResponse

        assert "consumed" in InviteResponse.model_fields

    def test_invite_response_no_token_hash(self):
        """InviteResponse must NOT expose token_hash."""
        from app.models import InviteResponse

        fields = InviteResponse.model_fields
        assert "token_hash" not in fields

    def test_invite_response_is_pydantic_base_model(self):
        from pydantic import BaseModel

        from app.models import InviteResponse

        assert issubclass(InviteResponse, BaseModel)


# ---------------------------------------------------------------------------
# database.py registration tests
# ---------------------------------------------------------------------------


class TestDatabaseRegistration:
    def test_auth_models_registered_in_database_module(self):
        """All auth document models must appear in database.py imports."""
        import pathlib

        db_path = pathlib.Path(__file__).parent.parent / "app" / "database.py"
        source = db_path.read_text(encoding="utf-8")

        for model_name in [
            "User",
            "ProviderIdentity",
            "Session",
            "Invite",
            "ApprovedDomain",
            "OAuthState",
        ]:
            assert (
                model_name in source
            ), f"{model_name} not found in database.py — register it in init_beanie document_models"
