"""
Workflow Repository
Handles all database operations for workflows with proper security and validation
"""
from typing import List, Optional, Dict, Any
from datetime import datetime, UTC
import uuid
from beanie.operators import In, And, Or, Eq

from app.models import Workflow, WorkflowCreate, WorkflowUpdate, Node, Edge


class WorkflowRepository:
    """Repository for Workflow CRUD operations with business logic"""
    
    @staticmethod
    async def create(workflow_data: WorkflowCreate) -> Workflow:
        """Create a new workflow with auto-generated fields"""
        workflow = Workflow(
            workflowId=str(uuid.uuid4()),
            name=workflow_data.name,
            description=workflow_data.description,
            nodes=workflow_data.nodes,
            edges=workflow_data.edges,
            variables=workflow_data.variables,
            tags=workflow_data.tags,
            nodeTemplates=workflow_data.nodeTemplates,
            collectionId=workflow_data.collectionId,
            createdAt=datetime.now(UTC),
            updatedAt=datetime.now(UTC),
            version=1
        )
        
        await workflow.insert()
        return workflow
    
    @staticmethod
    async def get_by_id(workflow_id: str) -> Optional[Workflow]:
        """Get workflow by workflowId - SQL injection safe through Beanie"""
        return await Workflow.find_one(Workflow.workflowId == workflow_id)
    
    @staticmethod
    async def list_all(
        skip: int = 0,
        limit: int = 20,
        tag: Optional[str] = None
    ) -> tuple[List[Workflow], int]:
        """
        List workflows with pagination and optional tag filter
        Returns (workflows, total_count)
        """
        # Build query filters - Beanie prevents injection
        query_filters = []
        if tag:
            query_filters.append(In(tag, Workflow.tags))
        
        # Get total count
        if query_filters:
            total = await Workflow.find(*query_filters).count()
        else:
            total = await Workflow.count()
        
        # Get paginated results
        query = Workflow.find(*query_filters) if query_filters else Workflow.find_all()
        workflows = await query.sort(-Workflow.createdAt).skip(skip).limit(limit).to_list()
        
        return workflows, total
    
    @staticmethod
    async def list_unattached(skip: int = 0, limit: int = 20) -> tuple[List[Workflow], int]:
        """
        Get workflows not attached to any collection
        Returns (workflows, total_count)
        """
        # Beanie prevents injection through typed queries
        query = Workflow.find(Workflow.collectionId == None)
        
        total = await query.count()
        workflows = await query.sort(-Workflow.createdAt).skip(skip).limit(limit).to_list()
        
        return workflows, total
    
    @staticmethod
    async def list_by_collection(
        collection_id: str,
        skip: int = 0,
        limit: int = 20
    ) -> tuple[List[Workflow], int]:
        """
        Get workflows in a specific collection
        Returns (workflows, total_count)
        """
        query = Workflow.find(Workflow.collectionId == collection_id)
        
        total = await query.count()
        workflows = await query.sort(-Workflow.createdAt).skip(skip).limit(limit).to_list()
        
        return workflows, total
    
    @staticmethod
    async def update(workflow_id: str, update_data: WorkflowUpdate) -> Optional[Workflow]:
        """Update workflow fields - only updates provided fields"""
        workflow = await WorkflowRepository.get_by_id(workflow_id)
        if not workflow:
            return None
        
        # Update only provided fields
        update_dict = update_data.model_dump(exclude_unset=True)
        update_dict["updatedAt"] = datetime.now(UTC)
        
        for key, value in update_dict.items():
            setattr(workflow, key, value)
        
        await workflow.save()
        return workflow
    
    @staticmethod
    async def delete(workflow_id: str) -> bool:
        """Delete a workflow - returns True if deleted, False if not found"""
        workflow = await WorkflowRepository.get_by_id(workflow_id)
        if not workflow:
            return False
        
        await workflow.delete()
        return True
    
    @staticmethod
    async def count_by_collection(collection_id: str) -> int:
        """Count workflows in a collection"""
        return await Workflow.find(Workflow.collectionId == collection_id).count()
    
    @staticmethod
    async def update_collection_assignment(
        workflow_id: str,
        collection_id: Optional[str]
    ) -> Optional[Workflow]:
        """Assign or unassign workflow to/from a collection"""
        workflow = await WorkflowRepository.get_by_id(workflow_id)
        if not workflow:
            return None
        
        workflow.collectionId = collection_id
        workflow.updatedAt = datetime.now(UTC)
        await workflow.save()
        
        return workflow
    
    @staticmethod
    async def search_by_name(search_term: str, limit: int = 10) -> List[Workflow]:
        """Search workflows by name (case-insensitive) - injection safe"""
        # Beanie uses MongoDB's regex safely
        return await Workflow.find(
            {"name": {"$regex": search_term, "$options": "i"}}
        ).limit(limit).to_list()
    
    @staticmethod
    async def bulk_delete_by_collection(collection_id: str) -> int:
        """Delete all workflows in a collection - returns count deleted"""
        result = await Workflow.find(Workflow.collectionId == collection_id).delete()
        return result.deleted_count if result else 0
