"""
Destructive database reset script for unreleased APIWeave.

WARNING: This drops ALL collections in the database. Use only during development
or when migrating to a new schema. Data cannot be recovered.

Usage:
    cd backend
    python scripts/wipe_db.py
"""

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from motor.motor_asyncio import AsyncIOMotorClient

from app.config import settings


async def wipe_database() -> None:
    """Drop all collections in the database."""
    client = AsyncIOMotorClient(settings.MONGODB_URL)
    db = client[settings.MONGODB_DB_NAME]

    collections = await db.list_collection_names()
    print(f"Dropping {len(collections)} collections from {settings.MONGODB_DB_NAME}:")
    for name in sorted(collections):
        print(f"  - {name}")
        await db.drop_collection(name)

    print("\nDatabase wiped successfully.")
    client.close()


if __name__ == "__main__":
    print("WARNING: This will DELETE ALL DATA in the database.")
    print(f"Database: {settings.MONGODB_DB_NAME}")
    print(f"URL: {settings.MONGODB_URL}")
    print()

    confirm = input("Type 'WIPE' to confirm: ")
    if confirm != "WIPE":
        print("Aborted.")
        sys.exit(1)

    asyncio.run(wipe_database())
