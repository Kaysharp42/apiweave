"""Subscription persistence (Phase 4 billing)."""

from __future__ import annotations

from app.models import Subscription


class SubscriptionRepository:
    @staticmethod
    async def get_for(owner_type: str, owner_id: str) -> Subscription | None:
        return await Subscription.find_one(
            Subscription.ownerType == owner_type,
            Subscription.ownerId == owner_id,
        )

    @staticmethod
    async def get_by_stripe_subscription(stripe_subscription_id: str) -> Subscription | None:
        return await Subscription.find_one(
            Subscription.stripeSubscriptionId == stripe_subscription_id
        )

    @staticmethod
    async def upsert(sub: Subscription) -> Subscription:
        existing = await SubscriptionRepository.get_for(sub.ownerType, sub.ownerId)
        if existing is None:
            await sub.insert()
            return sub
        # Copy mutable fields onto the existing row (keeps its _id / subscriptionId).
        existing.plan = sub.plan
        existing.status = sub.status
        existing.seats = sub.seats
        existing.stripeCustomerId = sub.stripeCustomerId
        existing.stripeSubscriptionId = sub.stripeSubscriptionId
        existing.currentPeriodEnd = sub.currentPeriodEnd
        existing.cancelAtPeriodEnd = sub.cancelAtPeriodEnd
        existing.updatedAt = sub.updatedAt
        await existing.save()
        return existing
