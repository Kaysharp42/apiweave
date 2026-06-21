"""
Webhook repository for CI/CD integration
Type-safe database operations for webhooks using Beanie ODM
"""

from datetime import UTC, datetime

from app.models import Webhook


class WebhookRepository:
    """Repository for Webhook operations"""

    @staticmethod
    async def create(webhook_data: dict) -> Webhook:
        """
        Create a new webhook

        Args:
            webhook_data: Webhook data dictionary

        Returns:
            Created Webhook document
        """
        webhook = Webhook(**webhook_data)
        await webhook.insert()
        return webhook

    @staticmethod
    async def get_by_id(webhook_id: str) -> Webhook | None:
        """
        Get webhook by webhookId

        Args:
            webhook_id: The webhookId to search for

        Returns:
            Webhook document or None if not found
        """
        return await Webhook.find_one(Webhook.webhookId == webhook_id)

    @staticmethod
    async def get_by_token(token: str) -> Webhook | None:
        """
        Get webhook by authentication token

        Args:
            token: The webhook token

        Returns:
            Webhook document or None if not found
        """
        return await Webhook.find_one(Webhook.token == token)

    @staticmethod
    async def get_by_resource(resource_type: str, resource_id: str) -> list[Webhook]:
        """
        Get all webhooks for a specific resource (workflow or collection)

        Args:
            resource_type: "workflow" or "collection"
            resource_id: The workflowId or collectionId

        Returns:
            List of Webhook documents
        """
        return await Webhook.find(
            Webhook.resourceType == resource_type, Webhook.resourceId == resource_id
        ).to_list()

    @staticmethod
    async def get_by_environment(environment_id: str) -> list[Webhook]:
        """
        Get all webhooks using a specific environment

        Args:
            environment_id: The environmentId

        Returns:
            List of Webhook documents
        """
        return await Webhook.find(Webhook.environmentId == environment_id).to_list()

    @staticmethod
    async def update(webhook_id: str, update_data: dict) -> Webhook | None:
        """
        Update webhook by webhookId

        Args:
            webhook_id: The webhookId to update
            update_data: Dictionary of fields to update

        Returns:
            Updated Webhook document or None if not found
        """
        webhook = await WebhookRepository.get_by_id(webhook_id)
        if not webhook:
            return None

        # Update fields
        for key, value in update_data.items():
            if hasattr(webhook, key):
                setattr(webhook, key, value)

        # Always update updatedAt timestamp
        webhook.updatedAt = datetime.now(UTC)

        await webhook.save()
        return webhook

    @staticmethod
    async def update_usage(webhook_id: str, status: str) -> Webhook | None:
        """
        Update webhook usage statistics

        Args:
            webhook_id: The webhookId to update
            status: Execution status ("success", "failure", "validation_error")

        Returns:
            Updated Webhook document or None if not found
        """
        webhook = await WebhookRepository.get_by_id(webhook_id)
        if not webhook:
            return None

        webhook.lastUsed = datetime.now(UTC)
        webhook.usageCount += 1
        webhook.lastStatus = status  # type: ignore

        await webhook.save()
        return webhook

    @staticmethod
    async def delete(webhook_id: str) -> bool:
        """
        Delete webhook by webhookId

        Args:
            webhook_id: The webhookId to delete

        Returns:
            True if deleted, False if not found
        """
        webhook = await WebhookRepository.get_by_id(webhook_id)
        if not webhook:
            return False

        await webhook.delete()
        return True

    @staticmethod
    async def list_all(skip: int = 0, limit: int = 100) -> list[Webhook]:
        """
        List all webhooks with pagination

        Args:
            skip: Number of documents to skip
            limit: Maximum number of documents to return

        Returns:
            List of Webhook documents
        """
        return await Webhook.find().skip(skip).limit(limit).to_list()

    @staticmethod
    async def count() -> int:
        """
        Count total number of webhooks

        Returns:
            Total count
        """
        return await Webhook.count()

    @staticmethod
    async def count_by_resource(resource_type: str, resource_id: str) -> int:
        """
        Count webhooks for a specific resource

        Args:
            resource_type: "workflow" or "collection"
            resource_id: The workflowId or collectionId

        Returns:
            Count of webhooks
        """
        return await Webhook.find(
            Webhook.resourceType == resource_type, Webhook.resourceId == resource_id
        ).count()
