"""
Collection Repository  
Handles all database operations for collections (workflow grouping)
"""
from typing import List, Optional
from datetime import datetime, UTC
import uuid

from app.models import Collection, CollectionCreate, CollectionUpdate


class CollectionRepository:
    """Repository for Collection CRUD operations"""
    
    @staticmethod
    async def create(collection_data: CollectionCreate) -> Collection:
        """Create a new collection"""
        collection = Collection(
            collectionId=str(uuid.uuid4()),
            name=collection_data.name,
            description=collection_data.description,
            color=collection_data.color,
            workflowCount=0,
            createdAt=datetime.now(UTC),
            updatedAt=datetime.now(UTC)
        )
        
        await collection.insert()
        return collection
    
    @staticmethod
    async def get_by_id(collection_id: str) -> Optional[Collection]:
        """Get collection by collectionId - SQL injection safe"""
        return await Collection.find_one(Collection.collectionId == collection_id)
    
    @staticmethod
    async def list_all(skip: int = 0, limit: int = 50) -> tuple[List[Collection], int]:
        """List all collections with pagination"""
        total = await Collection.count()
        collections = await Collection.find_all().sort(-Collection.createdAt).skip(skip).limit(limit).to_list()
        
        return collections, total
    
    @staticmethod
    async def update(collection_id: str, update_data: CollectionUpdate) -> Optional[Collection]:
        """Update collection fields"""
        collection = await CollectionRepository.get_by_id(collection_id)
        if not collection:
            return None
        
        # Update only provided fields
        update_dict = update_data.model_dump(exclude_unset=True)
        update_dict["updatedAt"] = datetime.now(UTC)
        
        for key, value in update_dict.items():
            setattr(collection, key, value)
        
        await collection.save()
        return collection
    
    @staticmethod
    async def delete(collection_id: str) -> bool:
        """Delete a collection"""
        collection = await CollectionRepository.get_by_id(collection_id)
        if not collection:
            return False
        
        await collection.delete()
        return True
    
    @staticmethod
    async def update_workflow_count(collection_id: str, count: int) -> Optional[Collection]:
        """Update the workflow count for a collection"""
        collection = await CollectionRepository.get_by_id(collection_id)
        if not collection:
            return None
        
        collection.workflowCount = count
        collection.updatedAt = datetime.now(UTC)
        await collection.save()
        
        return collection
    
    @staticmethod
    async def increment_workflow_count(collection_id: str) -> Optional[Collection]:
        """Increment workflow count by 1"""
        collection = await CollectionRepository.get_by_id(collection_id)
        if not collection:
            return None
        
        collection.workflowCount += 1
        collection.updatedAt = datetime.now(UTC)
        await collection.save()
        
        return collection
    
    @staticmethod
    async def decrement_workflow_count(collection_id: str) -> Optional[Collection]:
        """Decrement workflow count by 1"""
        collection = await CollectionRepository.get_by_id(collection_id)
        if not collection:
            return None
        
        if collection.workflowCount > 0:
            collection.workflowCount -= 1
            collection.updatedAt = datetime.now(UTC)
            await collection.save()
        
        return collection
    
    @staticmethod
    async def search_by_name(search_term: str, limit: int = 10) -> List[Collection]:
        """Search collections by name (case-insensitive)"""
        return await Collection.find(
            {"name": {"$regex": search_term, "$options": "i"}}
        ).limit(limit).to_list()
