from datetime import UTC, datetime, timedelta

from beanie.exceptions import CollectionWasNotInitialized

from app.auth.exceptions import OAuthLinkingBlockedError
from app.config import settings
from app.models import (
    ApprovedDomain,
    DeletedUser,
    Invite,
    OAuthAccount,
    OAuthState,
    ProviderIdentity,
    Session,
    User,
)


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
        """Delete user and all related data; returns True if deleted, False if not found"""
        user = await UserRepository.get_by_id(user_id)
        if not user:
            return False
        await DeletedUserRepository.create(user.userId, user.verified_email)
        await ProviderIdentityRepository.delete_by_user_id(user_id)
        await SessionRepository.delete_all_for_user(user_id)
        await user.delete()
        return True

    @staticmethod
    async def find_by_role(role: str) -> list[User]:
        """Find all users that have the given role"""
        return await User.find({"roles": role}).to_list()

    @staticmethod
    async def find_by_provider(provider: str, subject: str) -> User | None:
        """Return the first User whose oauth_accounts match (provider, providerSubject)."""
        return await User.find_one(
            {
                "oauth_accounts": {
                    "$elemMatch": {
                        "provider": provider,
                        "providerSubject": subject,
                    }
                }
            }
        )

    @staticmethod
    async def add_oauth_account(user: User, account: OAuthAccount) -> User:
        """Append an OAuthAccount to the user's oauth_accounts list and persist."""
        user.oauth_accounts.append(account)
        user.updated_at = datetime.now(UTC)
        await user.save()
        return user

    @staticmethod
    async def link_oauth_account(
        user: User,
        provider: str,
        subject: str,
        email: str,
        email_verified: bool,
    ) -> User:
        """
        Link an OAuth provider account to an existing user.

        Raises ``OAuthLinkingBlockedError`` (HTTP 409) when:
        - The user already has one or more OAuth accounts linked.
        - A **different** user already claims this ``verified_email``.

        On success the account is appended to ``user.oauth_accounts``
        and the document is saved.
        """
        if user.oauth_accounts:
            raise OAuthLinkingBlockedError(
                detail="Account linking is not supported. "
                "A user may only have one authentication method."
            )

        existing = await UserRepository.get_by_email(email)
        if existing is not None and existing.userId != user.userId:
            raise OAuthLinkingBlockedError(
                detail="This email is already associated with another user."
            )

        account = OAuthAccount(
            provider=provider,
            providerSubject=subject,
            linkedAt=datetime.now(UTC),
            emailVerified=email_verified,
        )
        return await UserRepository.add_oauth_account(user, account)


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

    @staticmethod
    async def delete_by_user_id(user_id: str) -> int:
        """Delete all identities for a user. Returns count deleted."""
        identities = await ProviderIdentity.find({"userId": user_id}).to_list()
        count = 0
        for identity in identities:
            await identity.delete()
            count += 1
        return count


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

    @staticmethod
    async def delete_all_for_user(user_id: str) -> int:
        """Delete all sessions for a user. Returns count deleted."""
        sessions = await Session.find({"userId": user_id}).to_list()
        count = 0
        for session in sessions:
            await session.delete()
            count += 1
        return count


class DeletedUserRepository:
    """Repository for tracking deleted users to prevent re-creation."""

    @staticmethod
    async def create(user_id: str, verified_email: str) -> DeletedUser:
        """Record a deleted user."""
        deleted = DeletedUser(
            userId=user_id,
            verified_email=verified_email,
            deleted_at=datetime.now(UTC),
        )
        await deleted.insert()
        return deleted

    @staticmethod
    async def is_deleted(user_id: str) -> bool:
        """Check if a user has been deleted."""
        try:
            return await DeletedUser.find_one({"userId": user_id}) is not None
        except CollectionWasNotInitialized:
            return False

    @staticmethod
    async def is_email_deleted(email: str) -> bool:
        """Check if an email belongs to a deleted user."""
        try:
            return await DeletedUser.find_one({"verified_email": email}) is not None
        except CollectionWasNotInitialized:
            return False

    @staticmethod
    async def delete_by_email(email: str) -> bool:
        """Remove a DeletedUser record by email (e.g. when re-inviting a previously deleted user).

        Returns True if a record was found and removed, False otherwise.
        """
        try:
            deleted_user = await DeletedUser.find_one({"verified_email": email})
            if not deleted_user:
                return False
            await deleted_user.delete()
            return True
        except CollectionWasNotInitialized:
            return False


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
        invite_url: str,
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
            invite_url=invite_url,
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
    async def find_active_by_email(email: str) -> Invite | None:
        """Find an unconsumed, unexpired invite by case-insensitive email."""
        now = datetime.now(UTC)
        return await Invite.find_one(
            {
                "$expr": {"$eq": [{"$toLower": "$email"}, email.lower()]},
                "consumed": False,
                "expires_at": {"$gt": now},
            }
        )

    @staticmethod
    async def update_role(invite_id: str, role_preset: str) -> Invite | None:
        """Update an invite role preset; returns None when missing."""
        invite = await InviteRepository.get_by_id(invite_id)
        if not invite:
            return None
        await invite.update({"$set": {"role_preset": role_preset}})
        invite.role_preset = role_preset
        return invite

    @staticmethod
    async def delete_invite(invite_id: str) -> bool:
        """Delete invite; returns True if deleted, False if not found."""
        invite = await InviteRepository.get_by_id(invite_id)
        if not invite:
            return False
        await invite.delete()
        return True

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
    async def unconsume(invite_id: str) -> bool:
        """Restore a consumed invite (rollback on user-creation failure).
        Returns True if restored, False if not found or was not consumed."""
        invite = await InviteRepository.get_by_id(invite_id)
        if not invite:
            return False
        if not invite.consumed:
            return False
        invite.consumed = False
        invite.consumed_at = None
        await invite.save()
        return True

    @staticmethod
    async def get_all() -> list[Invite]:
        """Return all invites"""
        return await Invite.find_all().to_list()

    @staticmethod
    async def list_pending() -> list[Invite]:
        """Return unconsumed, unexpired invites"""
        now = datetime.now(UTC)
        return await Invite.find(
            Invite.consumed == False,  # noqa: E712
            Invite.expires_at > now,
        ).to_list()


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
        invite_token: str | None = None,
    ) -> OAuthState:
        oauth_state = OAuthState(
            stateId=state_id,
            state=state,
            code_verifier=code_verifier,
            nonce=nonce,
            provider=provider,
            redirect_uri=redirect_uri,
            invite_token=invite_token,
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
