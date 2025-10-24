"""
Background worker for processing workflow runs
Polls MongoDB for pending jobs and executes them
"""
import asyncio
import sys
from datetime import datetime, UTC

from app.database import connect_db, close_db, get_database
from app.config import settings
from app.runner.executor import WorkflowExecutor


async def process_pending_runs():
    """Poll for and process pending workflow runs"""
    db = get_database()
    
    # Find a pending run and claim it atomically
    run = await db.runs.find_one_and_update(
        {"status": "pending"},
        {
            "$set": {
                "status": "running",
                "startedAt": datetime.now(UTC)
            }
        },
        sort=[("createdAt", 1)]  # FIFO - oldest first
    )
    
    if run:
        print(f"📋 Processing run: {run['runId']}")
        try:
            # Execute the workflow
            executor = WorkflowExecutor(run['runId'], run['workflowId'])
            await executor.execute()
            print(f"✅ Completed run: {run['runId']}")
        except Exception as e:
            print(f"❌ Run {run['runId']} failed: {e}")


async def worker_loop():
    """Main worker loop"""
    print("🚀 APIWeave Worker started")
    print(f"⏱️  Poll interval: {settings.WORKER_POLL_INTERVAL} seconds")
    
    await connect_db()
    
    try:
        while True:
            try:
                await process_pending_runs()
            except Exception as e:
                print(f"❌ Error processing run: {e}")
            
            # Wait before next poll
            await asyncio.sleep(settings.WORKER_POLL_INTERVAL)
            
    except KeyboardInterrupt:
        print("\n🛑 Worker stopped by user")
    finally:
        await close_db()


def main():
    """Entry point"""
    try:
        asyncio.run(worker_loop())
    except KeyboardInterrupt:
        print("\n👋 Worker shutdown complete")
        sys.exit(0)


if __name__ == "__main__":
    main()
