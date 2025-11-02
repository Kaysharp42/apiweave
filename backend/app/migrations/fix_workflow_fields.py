"""
Database migration script to fix workflows missing required fields.
This script adds default values for workflowId, createdAt, and updatedAt fields
to any workflows that are missing them.

Run with: python -m app.migrations.fix_workflow_fields
"""
import asyncio
from datetime import datetime, UTC
from motor.motor_asyncio import AsyncIOMotorClient
from bson import ObjectId
import uuid
import os


async def migrate_workflows():
    """Fix all workflows missing required fields"""
    # Connect to MongoDB
    mongodb_url = os.getenv("MONGODB_URL", "mongodb://localhost:27017")
    client = AsyncIOMotorClient(mongodb_url)
    db = client.get_database("apiweave")
    
    print("Starting workflow migration...")
    
    # Find all workflows
    cursor = db.workflows.find({})
    workflows = await cursor.to_list(length=None)
    
    fixed_count = 0
    skipped_count = 0
    
    for workflow in workflows:
        workflow_id = workflow.get("_id")
        needs_update = False
        update_doc = {}
        
        # Check and fix workflowId
        if "workflowId" not in workflow:
            update_doc["workflowId"] = str(workflow_id)
            needs_update = True
            print(f"  - Adding workflowId for workflow {workflow_id}")
        
        # Check and fix createdAt
        if "createdAt" not in workflow:
            update_doc["createdAt"] = datetime.now(UTC)
            needs_update = True
            print(f"  - Adding createdAt for workflow {workflow_id}")
        
        # Check and fix updatedAt
        if "updatedAt" not in workflow:
            update_doc["updatedAt"] = datetime.now(UTC)
            needs_update = True
            print(f"  - Adding updatedAt for workflow {workflow_id}")
        
        # Update the workflow if needed
        if needs_update:
            result = await db.workflows.update_one(
                {"_id": workflow_id},
                {"$set": update_doc}
            )
            if result.modified_count > 0:
                fixed_count += 1
                print(f"  ✓ Fixed workflow {workflow_id}")
            else:
                print(f"  ✗ Failed to fix workflow {workflow_id}")
        else:
            skipped_count += 1
    
    print(f"\nMigration complete!")
    print(f"  - Fixed: {fixed_count} workflows")
    print(f"  - Skipped: {skipped_count} workflows (already valid)")
    print(f"  - Total: {len(workflows)} workflows")
    
    client.close()


if __name__ == "__main__":
    asyncio.run(migrate_workflows())
