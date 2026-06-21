from app.models import ProviderIdentity


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
    async def get_by_provider_subject(provider: str, subject: str) -> ProviderIdentity | None:
        """Find identity by (provider, subject) compound key"""
        return await ProviderIdentity.find_one(
            ProviderIdentity.provider == provider,
            ProviderIdentity.subject == subject,
        )

    @staticmethod
    async def get_by_user_id(user_id: str) -> list[ProviderIdentity]:
        """Return all identities linked to a user"""
        return await ProviderIdentity.find(ProviderIdentity.userId == user_id).to_list()

    @staticmethod
    async def get_by_email(email: str) -> list[ProviderIdentity]:
        """Return all identities with the given verified email (account linking)"""
        return await ProviderIdentity.find(ProviderIdentity.email == email).to_list()

    @staticmethod
    async def delete(identity_id: str) -> bool:
        """Delete identity; returns True if deleted, False if not found"""
        identity = await ProviderIdentity.find_one(ProviderIdentity.identityId == identity_id)
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
