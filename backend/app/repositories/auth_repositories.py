from datetime import UTC, datetime, timedelta

from app.config import settings
from app.models import ApprovedDomain, Invite, OAuthState, ProviderIdentity, Session, User


class UserRepository:
    """Repository for User CRUD operations"""

    @staticmethod
    async def create(
        user_id: str,
        verified_email: str,
        display_name: str | None,
        avatar_url: str | None,
        roles: list[str],
        permissions: list[str],
    ) -> User:
        """Create and persist a new user"""
        now = datetime.now(UTC)
        user = User(
            userId=user_id,
            verified_email=verified_email,
            display_name=display_name,
            avatar_url=avatar_url,
            roles=roles,
            permissions=permissions,
            is_setup_complete=False,
            created_at=now,
            updated_at=now,
        )
        await user.insert()
        return user

    @staticmethod
    async def get_by_id(user_id: str) -> User | None:
        """Find user by userId"""
        return await User.find_one(User.userId == user_id)

    @staticmethod
    async def get_by_email(verified_email: str) -> User | None:
        """Find user by verified_email (canonical linking key)"""
        return await User.find_one(User.verified_email == verified_email)

    @staticmethod
    async def get_all() -> list[User]:
        """Return all users"""
        return await User.find_all().to_list()

    @staticmethod
    async def update(user_id: str, **kwargs: object) -> User | None:
        """Update arbitrary user fields; always bumps updated_at"""
        user = await UserRepository.get_by_id(user_id)
        if not user:
            return None
        kwargs["updated_at"] = datetime.now(UTC)
        for key, value in kwargs.items():
            setattr(user, key, value)
        await user.save()
        return user

    @staticmethod
    async def count() -> int:
        """Return total user count (0 → setup mode)"""
        return await User.count()

    @staticmethod
    async def delete(user_id: str) -> bool:
        """Delete user; returns True if deleted, False if not found"""
        user = await UserRepository.get_by_id(user_id)
        if not user:
            return False
        await user.delete()
        return True

    @staticmethod
    async def find_by_role(role: str) -> list[User]:
        """Find all users that have the given role"""
        return await User.find({"roles": role}).to_list()


class ProviderIdentityRepository:
    """Repository for ProviderIdentity CRUD operations"""

    @staticmethod
    async def create(
        identity_id: str,
        user_id: str,
        provider: str,
        subject: str,
        email: str,
        verified: bool,
    ) -> ProviderIdentity:
        """Create and persist a provider identity"""
        identity = ProviderIdentity(
            identityId=identity_id,
            userId=user_id,
            provider=provider,
            subject=subject,
            email=email,
            verified=verified,
        )
        await identity.insert()
        return identity

    @staticmethod
    async def get_by_provider_subject(
        provider: str, subject: str
    ) -> ProviderIdentity | None:
        """Find identity by (provider, subject) compound key"""
        return await ProviderIdentity.find_one(
            ProviderIdentity.provider == provider,
            ProviderIdentity.subject == subject,
        )

    @staticmethod
    async def get_by_user_id(user_id: str) -> list[ProviderIdentity]:
        """Return all identities linked to a user"""
        return await ProviderIdentity.find(
            ProviderIdentity.userId == user_id
        ).to_list()

    @staticmethod
    async def get_by_email(email: str) -> list[ProviderIdentity]:
        """Return all identities with the given verified email (account linking)"""
        return await ProviderIdentity.find(
            ProviderIdentity.email == email
        ).to_list()

    @staticmethod
    async def delete(identity_id: str) -> bool:
        """Delete identity; returns True if deleted, False if not found"""
        identity = await ProviderIdentity.find_one(
            ProviderIdentity.identityId == identity_id
        )
        if not identity:
            return False
        await identity.delete()
        return True


class SessionRepository:
    """Repository for Session operations with idle/absolute expiry enforcement"""

    @staticmethod
    def is_active(session: Session) -> bool:
        """
        Pure-Python check — no DB call.

        A session is active when ALL of the following hold:
        1. Not revoked
        2. expires_at (absolute) has not passed
        3. last_seen_at is within the idle window (SESSION_MAX_IDLE_MINUTES)
        """
        if session.revoked:
            return False

        now = datetime.now(UTC)

        # Absolute expiry
        expires_at = session.expires_at
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=UTC)
        if now >= expires_at:
            return False

        # Idle expiry
        last_seen = session.last_seen_at
        if last_seen.tzinfo is None:
            last_seen = last_seen.replace(tzinfo=UTC)
        idle_deadline = last_seen + timedelta(minutes=settings.SESSION_MAX_IDLE_MINUTES)
        if now >= idle_deadline:
            return False

        return True

    @staticmethod
    async def create(
        session_id: str,
        user_id: str,
        token_hash: str,
        created_at: datetime,
        last_seen_at: datetime,
        expires_at: datetime,
    ) -> Session:
        """Create and persist a new session"""
        session = Session(
            sessionId=session_id,
            userId=user_id,
            token_hash=token_hash,
            created_at=created_at,
            last_seen_at=last_seen_at,
            expires_at=expires_at,
            revoked=False,
        )
        await session.insert()
        return session

    @staticmethod
    async def get_by_token_hash(token_hash: str) -> Session | None:
        """Find session by hashed token"""
        return await Session.find_one(Session.token_hash == token_hash)

    @staticmethod
    async def get_by_id(session_id: str) -> Session | None:
        """Find session by sessionId"""
        return await Session.find_one(Session.sessionId == session_id)

    @staticmethod
    async def get_active_sessions_for_user(user_id: str) -> list[Session]:
        """
        Return sessions for user that are not revoked and not absolutely expired.
        Idle expiry is checked in Python via is_active() — callers should filter
        further if they need strict idle enforcement.
        """
        now = datetime.now(UTC)
        sessions = await Session.find(
            Session.userId == user_id,
            Session.revoked == False,  # noqa: E712
            Session.expires_at > now,
        ).to_list()
        # Apply idle check in Python
        return [s for s in sessions if SessionRepository.is_active(s)]

    @staticmethod
    async def touch(session_id: str, last_seen_at: datetime) -> bool:
        """Update last_seen_at to extend idle window"""
        session = await SessionRepository.get_by_id(session_id)
        if not session:
            return False
        session.last_seen_at = last_seen_at
        await session.save()
        return True

    @staticmethod
    async def revoke(session_id: str) -> bool:
        """Mark a single session as revoked"""
        session = await SessionRepository.get_by_id(session_id)
        if not session:
            return False
        session.revoked = True
        await session.save()
        return True

    @staticmethod
    async def revoke_all_for_user(user_id: str) -> int:
        """
        Revoke all non-revoked sessions for a user (concurrent logout).
        Returns the number of sessions revoked.
        """
        sessions = await Session.find(
            Session.userId == user_id,
            Session.revoked == False,  # noqa: E712
        ).to_list()
        count = 0
        for session in sessions:
            session.revoked = True
            await session.save()
            count += 1
        return count


class InviteRepository:
    """Repository for Invite operations with one-time consumption enforcement"""

    @staticmethod
    async def create(
        invite_id: str,
        email: str,
        token_hash: str,
        role_preset: str,
        created_by: str,
        created_at: datetime,
        expires_at: datetime,
    ) -> Invite:
        """Create and persist an invite. token_hash must be pre-hashed by caller."""
        invite = Invite(
            inviteId=invite_id,
            email=email,
            token_hash=token_hash,
            role_preset=role_preset,
            created_by=created_by,
            created_at=created_at,
            expires_at=expires_at,
            consumed=False,
            consumed_at=None,
        )
        await invite.insert()
        return invite

    @staticmethod
    async def get_by_token_hash(token_hash: str) -> Invite | None:
        """Find invite by hashed token"""
        return await Invite.find_one(Invite.token_hash == token_hash)

    @staticmethod
    async def get_by_id(invite_id: str) -> Invite | None:
        """Find invite by inviteId"""
        return await Invite.find_one(Invite.inviteId == invite_id)

    @staticmethod
    async def get_valid_by_email(email: str) -> list[Invite]:
        """Return invites for email that are not consumed and not expired"""
        now = datetime.now(UTC)
        return await Invite.find(
            Invite.email == email,
            Invite.consumed == False,  # noqa: E712
            Invite.expires_at > now,
        ).to_list()

    @staticmethod
    async def consume(invite_id: str) -> bool:
        """
        Mark invite as consumed (one-time use).
        Returns False if already consumed or not found.
        """
        invite = await InviteRepository.get_by_id(invite_id)
        if not invite:
            return False
        if invite.consumed:
            return False
        invite.consumed = True
        invite.consumed_at = datetime.now(UTC)
        await invite.save()
        return True

    @staticmethod
    async def get_all() -> list[Invite]:
        """Return all invites"""
        return await Invite.find_all().to_list()


class ApprovedDomainRepository:
    """Repository for ApprovedDomain operations"""

    @staticmethod
    async def create(
        domain_id: str,
        domain: str,
        created_by: str,
        created_at: datetime,
    ) -> ApprovedDomain:
        """Create and persist an approved domain"""
        approved = ApprovedDomain(
            domainId=domain_id,
            domain=domain,
            created_by=created_by,
            created_at=created_at,
        )
        await approved.insert()
        return approved

    @staticmethod
    async def get_by_domain(domain: str) -> ApprovedDomain | None:
        """Find approved domain by domain string"""
        return await ApprovedDomain.find_one(ApprovedDomain.domain == domain)

    @staticmethod
    async def is_domain_approved(domain: str) -> bool:
        """Return True if domain is in the approved list"""
        result = await ApprovedDomainRepository.get_by_domain(domain)
        return result is not None

    @staticmethod
    async def list_all() -> list[ApprovedDomain]:
        """Return all approved domains"""
        return await ApprovedDomain.find_all().to_list()

    @staticmethod
    async def delete(domain_id: str) -> bool:
        """Delete approved domain; returns True if deleted, False if not found"""
        approved = await ApprovedDomain.find_one(
            ApprovedDomain.domainId == domain_id
        )
        if not approved:
            return False
        await approved.delete()
        return True


class OAuthStateRepository:
    @staticmethod
    async def create(
        state_id: str,
        state: str,
        code_verifier: str,
        nonce: str,
        provider: str,
        redirect_uri: str,
        expires_at: datetime,
    ) -> OAuthState:
        oauth_state = OAuthState(
            stateId=state_id,
            state=state,
            code_verifier=code_verifier,
            nonce=nonce,
            provider=provider,
            redirect_uri=redirect_uri,
            expires_at=expires_at,
        )
        await oauth_state.insert()
        return oauth_state

    @staticmethod
    async def get_by_state(state: str) -> OAuthState | None:
        return await OAuthState.find_one(OAuthState.state == state)

    @staticmethod
    async def consume(state: str) -> OAuthState | None:
        oauth_state = await OAuthStateRepository.get_by_state(state)
        if not oauth_state:
            return None
        await oauth_state.delete()
        return oauth_state
