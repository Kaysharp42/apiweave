from datetime import UTC, datetime

from beanie.exceptions import CollectionWasNotInitialized

from app.models import DeletedUser


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
