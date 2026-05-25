"""
MongoDB database connection and utilities with Beanie ODM
"""
import logging
from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase
from beanie import init_beanie
from app.config import settings
from app.models import (
    Workflow, Run, Environment, Collection, Webhook, CollectionRun, WebhookLog,
    User, ProviderIdentity, Session, Invite, ApprovedDomain, OAuthState,
)

logger = logging.getLogger(__name__)

# Global database client
client: AsyncIOMotorClient = None
db: AsyncIOMotorDatabase = None


async def connect_db():
    """Connect to MongoDB and initialize Beanie ODM"""
    global client, db

    client = AsyncIOMotorClient(settings.MONGODB_URL)
    db = client[settings.MONGODB_DB_NAME]

    # Initialize Beanie with Document models
    await init_beanie(
        database=db,
        document_models=[
            Workflow,
            Run,
            Environment,
            Collection,
            Webhook,
            CollectionRun,
            WebhookLog,
            User,
            ProviderIdentity,
            Session,
            Invite,
            ApprovedDomain,
            OAuthState,
        ]
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
    return db
