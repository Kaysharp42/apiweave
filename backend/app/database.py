"""
MongoDB database connection and utilities
"""
from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase
from app.config import settings

# Global database client
client: AsyncIOMotorClient = None
db: AsyncIOMotorDatabase = None


async def connect_db():
    """Connect to MongoDB"""
    global client, db
    
    client = AsyncIOMotorClient(settings.MONGODB_URL)
    db = client[settings.MONGODB_DB_NAME]
    
    print(f"✅ Connected to MongoDB: {settings.MONGODB_DB_NAME}")
    
    # Create indexes
    await create_indexes()


async def close_db():
    """Close MongoDB connection"""
    global client
    
    if client:
        client.close()
        print("❌ Closed MongoDB connection")


async def create_indexes():
    """Create database indexes"""
    global db
    
    # Workflows collection
    await db.workflows.create_index("workflowId", unique=True)
    await db.workflows.create_index([("createdAt", -1)])
    
    # Runs collection
    await db.runs.create_index("runId", unique=True)
    await db.runs.create_index([("status", 1), ("createdAt", 1)])
    await db.runs.create_index("workflowId")
    
    print("✅ Created database indexes")


def get_database() -> AsyncIOMotorDatabase:
    """Get database instance"""
    return db
