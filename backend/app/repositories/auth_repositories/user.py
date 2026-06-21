from datetime import UTC, datetime

from app.auth.exceptions import OAuthLinkingBlockedError
from app.models import OAuthAccount, User

from .deleted_user import DeletedUserRepository
from .provider_identity import ProviderIdentityRepository
from .session import SessionRepository


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
