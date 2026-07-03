"""
MongoDB database connection and utilities with Beanie ODM
"""

import logging

from beanie import init_beanie
from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase

from app.config import settings
from app.models import (
    ApprovedDomain,
    AuditEvent,
    CollectionRun,
    DeletedUser,
    EmailAuthToken,
    Environment,
    EnvironmentProtection,
    IdempotencyKey,
    Invite,
    OAuthState,
    Organization,
    OrganizationMember,
    OrgInvite,
    OutsideCollaborator,
    PendingRunApproval,
    Project,
    ProviderIdentity,
    RateLimitCounter,
    Run,
    ScopedKeypair,
    Secret,
    SecretBinding,
    ServiceToken,
    Session,
    Subscription,
    Team,
    TeamMember,
    TeamPermissionGrant,
    User,
    Webhook,
    WebhookLog,
    Workflow,
    Workspace,
    WorkspaceMember,
)

logger = logging.getLogger(__name__)

# Global database client
client: AsyncIOMotorClient | None = None
db: AsyncIOMotorDatabase | None = None


async def connect_db():
    """Connect to MongoDB and initialize Beanie ODM"""
    global client, db

    client = AsyncIOMotorClient(settings.MONGODB_URL)
    db = client[settings.MONGODB_DB_NAME]

    # Initialize Beanie with Document models
    await init_beanie(
        database=db,
        document_models=[
            # Core workflow models
            Workflow,
            Run,
            Environment,
            Project,  # Collection alias — same document class
            Webhook,
            CollectionRun,
            WebhookLog,
            IdempotencyKey,
            RateLimitCounter,
            EmailAuthToken,
            # Auth models
            User,
            DeletedUser,
            ProviderIdentity,
            Session,
            Invite,
            ApprovedDomain,
            OAuthState,
            # Encryption / secrets / audit
            AuditEvent,
            ScopedKeypair,
            Secret,
            SecretBinding,
            # Multi-tenant models
            Organization,
            OrganizationMember,
            Subscription,
            Team,
            TeamMember,
            Workspace,
            WorkspaceMember,
            OutsideCollaborator,
            EnvironmentProtection,
            ServiceToken,
            OrgInvite,
            TeamPermissionGrant,
            PendingRunApproval,
        ],
    )

    logger.info("Connected to MongoDB: %s", settings.MONGODB_DB_NAME)
    logger.info("Initialized Beanie ODM with type-safe models")


async def close_db():
    """Close MongoDB connection"""
    global client

    if client:
        client.close()
        logger.info("Closed MongoDB connection")


def get_database() -> AsyncIOMotorDatabase:
    """
    Get database instance
    Note: With Beanie, you typically don't need direct database access.
    Use Document models and repositories instead for type safety.
    """
    if db is None:
        raise RuntimeError("Database not initialized. Call connect_db() first.")
    return db
