"""
CollectionRun repository for tracking collection execution results
Type-safe database operations for collection runs using Beanie ODM
"""
from typing import List, Optional
from datetime import datetime, UTC
from app.models import CollectionRun


class CollectionRunRepository:
    """Repository for CollectionRun operations"""
    
    @staticmethod
    async def create(collection_run_data: dict) -> CollectionRun:
        """
        Create a new collection run
        
        Args:
            collection_run_data: CollectionRun data dictionary
            
        Returns:
            Created CollectionRun document
        """
        collection_run = CollectionRun(**collection_run_data)
        await collection_run.insert()
        return collection_run
    
    @staticmethod
    async def get_by_id(collection_run_id: str) -> Optional[CollectionRun]:
        """
        Get collection run by collectionRunId
        
        Args:
            collection_run_id: The collectionRunId to search for
            
        Returns:
            CollectionRun document or None if not found
        """
        return await CollectionRun.find_one(CollectionRun.collectionRunId == collection_run_id)
    
    @staticmethod
    async def get_by_collection(collection_id: str, skip: int = 0, limit: int = 50) -> List[CollectionRun]:
        """
        Get collection runs for a specific collection with pagination
        
        Args:
            collection_id: The collectionId
            skip: Number of documents to skip
            limit: Maximum number of documents to return
            
        Returns:
            List of CollectionRun documents, sorted by startTime (newest first)
        """
        return await CollectionRun.find(
            CollectionRun.collectionId == collection_id
        ).sort("-startTime").skip(skip).limit(limit).to_list()
    
    @staticmethod
    async def get_by_webhook(webhook_id: str, skip: int = 0, limit: int = 50) -> List[CollectionRun]:
        """
        Get collection runs triggered by a specific webhook
        
        Args:
            webhook_id: The webhookId
            skip: Number of documents to skip
            limit: Maximum number of documents to return
            
        Returns:
            List of CollectionRun documents
        """
        return await CollectionRun.find(
            CollectionRun.webhookId == webhook_id
        ).sort("-startTime").skip(skip).limit(limit).to_list()
    
    @staticmethod
    async def update(collection_run_id: str, update_data: dict) -> Optional[CollectionRun]:
        """
        Update collection run by collectionRunId
        
        Args:
            collection_run_id: The collectionRunId to update
            update_data: Dictionary of fields to update
            
        Returns:
            Updated CollectionRun document or None if not found
        """
        collection_run = await CollectionRunRepository.get_by_id(collection_run_id)
        if not collection_run:
            return None
        
        # Update fields
        for key, value in update_data.items():
            if hasattr(collection_run, key):
                setattr(collection_run, key, value)
        
        await collection_run.save()
        return collection_run
    
    @staticmethod
    async def update_fields(collection_run_id: str, **fields) -> Optional[CollectionRun]:
        """
        Update specific fields of a collection run
        
        Args:
            collection_run_id: The collectionRunId to update
            **fields: Key-value pairs of fields to update
            
        Returns:
            Updated CollectionRun document or None if not found
        """
        collection_run = await CollectionRunRepository.get_by_id(collection_run_id)
        if not collection_run:
            return None
        
        for key, value in fields.items():
            if hasattr(collection_run, key):
                setattr(collection_run, key, value)
        
        await collection_run.save()
        return collection_run
    
    @staticmethod
    async def add_workflow_result(collection_run_id: str, workflow_result: dict) -> Optional[CollectionRun]:
        """
        Add a workflow result to the collection run
        
        Args:
            collection_run_id: The collectionRunId to update
            workflow_result: Workflow result dictionary
            
        Returns:
            Updated CollectionRun document or None if not found
        """
        collection_run = await CollectionRunRepository.get_by_id(collection_run_id)
        if not collection_run:
            return None
        
        # Add workflow result
        collection_run.workflowResults.append(workflow_result)
        
        # Update counters
        collection_run.executedWorkflows += 1
        if workflow_result.get("passed"):
            collection_run.passedWorkflows += 1
        else:
            collection_run.failedWorkflows += 1
        
        await collection_run.save()
        return collection_run
    
    @staticmethod
    async def complete(
        collection_run_id: str,
        status: str,
        end_time: datetime,
        duration: int
    ) -> Optional[CollectionRun]:
        """
        Mark collection run as completed
        
        Args:
            collection_run_id: The collectionRunId to update
            status: Final status ("completed" or "failed")
            end_time: End timestamp
            duration: Total duration in milliseconds
            
        Returns:
            Updated CollectionRun document or None if not found
        """
        return await CollectionRunRepository.update_fields(
            collection_run_id,
            status=status,
            endTime=end_time,
            duration=duration
        )
    
    @staticmethod
    async def delete(collection_run_id: str) -> bool:
        """
        Delete collection run by collectionRunId
        
        Args:
            collection_run_id: The collectionRunId to delete
            
        Returns:
            True if deleted, False if not found
        """
        collection_run = await CollectionRunRepository.get_by_id(collection_run_id)
        if not collection_run:
            return False
        
        await collection_run.delete()
        return True
    
    @staticmethod
    async def count_by_collection(collection_id: str) -> int:
        """
        Count collection runs for a specific collection
        
        Args:
            collection_id: The collectionId
            
        Returns:
            Count of collection runs
        """
        return await CollectionRun.find(
            CollectionRun.collectionId == collection_id
        ).count()
    
    @staticmethod
    async def get_latest_by_collection(collection_id: str) -> Optional[CollectionRun]:
        """
        Get the most recent collection run for a collection
        
        Args:
            collection_id: The collectionId
            
        Returns:
            Latest CollectionRun document or None if not found
        """
        runs = await CollectionRun.find(
            CollectionRun.collectionId == collection_id
        ).sort("-startTime").limit(1).to_list()
        
        return runs[0] if runs else None
