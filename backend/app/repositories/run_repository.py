"""
Run Repository
Handles all database operations for workflow runs
"""
from typing import List, Optional, Dict, Any
from datetime import datetime, UTC
import uuid

from app.models import Run, RunCreate, RunResult


class RunRepository:
    """Repository for Run CRUD operations"""
    
    @staticmethod
    async def create(run_data: RunCreate) -> Run:
        """Create a new workflow run"""
        run = Run(
            runId=str(uuid.uuid4()),
            workflowId=run_data.workflowId,
            status="pending",
            trigger="manual",
            variables=run_data.variables or {},
            callbackUrl=run_data.callbackUrl,
            results=[],
            createdAt=datetime.now(UTC),
            startedAt=None,
            completedAt=None,
            duration=None,
            error=None
        )
        
        await run.insert()
        return run
    
    @staticmethod
    async def get_by_id(run_id: str) -> Optional[Run]:
        """Get run by runId - SQL injection safe"""
        return await Run.find_one(Run.runId == run_id)
    
    @staticmethod
    async def list_by_workflow(
        workflow_id: str,
        skip: int = 0,
        limit: int = 20
    ) -> tuple[List[Run], int]:
        """Get runs for a specific workflow"""
        query = Run.find(Run.workflowId == workflow_id)
        
        total = await query.count()
        runs = await query.sort(-Run.createdAt).skip(skip).limit(limit).to_list()
        
        return runs, total
    
    @staticmethod
    async def list_all(skip: int = 0, limit: int = 20) -> tuple[List[Run], int]:
        """List all runs with pagination"""
        total = await Run.count()
        runs = await Run.find_all().sort(-Run.createdAt).skip(skip).limit(limit).to_list()
        
        return runs, total
    
    @staticmethod
    async def update_status(
        run_id: str,
        status: str,
        error: Optional[str] = None
    ) -> Optional[Run]:
        """Update run status"""
        run = await RunRepository.get_by_id(run_id)
        if not run:
            return None
        
        run.status = status
        if error:
            run.error = error
        
        if status == "running" and not run.startedAt:
            run.startedAt = datetime.now(UTC)
        
        if status in ["completed", "failed", "cancelled"]:
            run.completedAt = datetime.now(UTC)
            if run.startedAt:
                run.duration = int((run.completedAt - run.startedAt).total_seconds() * 1000)
        
        await run.save()
        return run
    
    @staticmethod
    async def add_result(run_id: str, result: RunResult) -> Optional[Run]:
        """Add a node execution result to the run"""
        run = await RunRepository.get_by_id(run_id)
        if not run:
            return None
        
        run.results.append(result)
        await run.save()
        
        return run
    
    @staticmethod
    async def update_results(run_id: str, results: List[RunResult]) -> Optional[Run]:
        """Update all results for a run"""
        run = await RunRepository.get_by_id(run_id)
        if not run:
            return None
        
        run.results = results
        await run.save()
        
        return run
    
    @staticmethod
    async def delete(run_id: str) -> bool:
        """Delete a run"""
        run = await RunRepository.get_by_id(run_id)
        if not run:
            return False
        
        await run.delete()
        return True
    
    @staticmethod
    async def delete_by_workflow(workflow_id: str) -> int:
        """Delete all runs for a workflow - returns count deleted"""
        result = await Run.find(Run.workflowId == workflow_id).delete()
        return result.deleted_count if result else 0
    
    @staticmethod
    async def get_recent_runs(limit: int = 10) -> List[Run]:
        """Get most recent runs across all workflows"""
        return await Run.find_all().sort(-Run.createdAt).limit(limit).to_list()

    @staticmethod
    async def get_latest_failed_run(workflow_id: str) -> Optional[Run]:
        """Get latest failed run for a workflow"""
        return await Run.find(
            Run.workflowId == workflow_id,
            Run.status == "failed",
        ).sort(-Run.createdAt).first_or_none()

    @staticmethod
    async def get_latest_run(workflow_id: str) -> Optional[Run]:
        """Get latest run for a workflow regardless of status"""
        return await Run.find(
            Run.workflowId == workflow_id,
        ).sort(-Run.createdAt).first_or_none()
    
    @staticmethod
    async def count_by_status(workflow_id: Optional[str] = None) -> Dict[str, int]:
        """Get count of runs by status"""
        query = Run.find(Run.workflowId == workflow_id) if workflow_id else Run.find_all()
        
        all_runs = await query.to_list()
        
        counts = {
            "pending": 0,
            "running": 0,
            "completed": 0,
            "failed": 0,
            "cancelled": 0
        }
        
        for run in all_runs:
            counts[run.status] = counts.get(run.status, 0) + 1
        
        return counts
    
    @staticmethod
    async def update_fields(run_id: str, **fields) -> Optional[Run]:
        """Update specific fields of a run"""
        run = await RunRepository.get_by_id(run_id)
        if not run:
            return None
        
        for field, value in fields.items():
            if hasattr(run, field):
                setattr(run, field, value)
        
        await run.save()
        return run
