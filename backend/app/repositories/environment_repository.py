"""
Environment Repository
Handles all database operations for environments (variables and secrets)
"""
from typing import List, Optional, Dict, Any
from datetime import datetime, UTC
import uuid

from app.models import Environment, EnvironmentCreate, EnvironmentUpdate, EncryptedBlob


class EnvironmentRepository:
    """Repository for Environment CRUD operations"""

    @staticmethod
    def _normalize_swagger_doc_url(url: Optional[str]) -> Optional[str]:
        """Normalize Swagger/OpenAPI URL field."""
        if url is None:
            return None
        normalized = url.strip()
        return normalized if normalized else None
    
    @staticmethod
    async def create(env_data: EnvironmentCreate) -> Environment:
        """Create a new environment"""
        environment = Environment(
            environmentId=str(uuid.uuid4()),
            name=env_data.name,
            description=env_data.description,
            swaggerDocUrl=EnvironmentRepository._normalize_swagger_doc_url(env_data.swaggerDocUrl),
            variables=env_data.variables,
            secrets=env_data.secrets,
            isActive=False,
            createdAt=datetime.now(UTC),
            updatedAt=datetime.now(UTC)
        )
        
        await environment.insert()
        return environment
    
    @staticmethod
    async def get_by_id(environment_id: str) -> Optional[Environment]:
        """Get environment by environmentId - SQL injection safe"""
        return await Environment.find_one(Environment.environmentId == environment_id)
    
    @staticmethod
    async def list_all(skip: int = 0, limit: int = 50) -> tuple[List[Environment], int]:
        """List all environments with pagination"""
        total = await Environment.count()
        environments = await Environment.find_all().sort(-Environment.createdAt).skip(skip).limit(limit).to_list()
        
        return environments, total
    
    @staticmethod
    async def update(environment_id: str, update_data: EnvironmentUpdate) -> Optional[Environment]:
        """Update environment fields"""
        environment = await EnvironmentRepository.get_by_id(environment_id)
        if not environment:
            return None
        
        # Update only provided fields
        update_dict = update_data.model_dump(exclude_unset=True)

        if "swaggerDocUrl" in update_dict:
            update_dict["swaggerDocUrl"] = EnvironmentRepository._normalize_swagger_doc_url(
                update_dict["swaggerDocUrl"]
            )

        update_dict["updatedAt"] = datetime.now(UTC)
        
        for key, value in update_dict.items():
            setattr(environment, key, value)
        
        await environment.save()
        return environment
    
    @staticmethod
    async def delete(environment_id: str) -> bool:
        """Delete an environment"""
        environment = await EnvironmentRepository.get_by_id(environment_id)
        if not environment:
            return False
        
        await environment.delete()
        return True
    
    @staticmethod
    async def get_active() -> Optional[Environment]:
        """Get the currently active environment"""
        return await Environment.find_one(Environment.isActive == True)
    
    @staticmethod
    async def set_active(environment_id: str) -> Optional[Environment]:
        """Set an environment as active (deactivates all others)"""
        # Deactivate all environments
        all_envs = await Environment.find_all().to_list()
        for env in all_envs:
            env.isActive = False
            await env.save()
        
        # Activate the specified environment
        environment = await EnvironmentRepository.get_by_id(environment_id)
        if environment:
            environment.isActive = True
            environment.updatedAt = datetime.now(UTC)
            await environment.save()
        
        return environment
    
    @staticmethod
    async def update_variable(
        environment_id: str,
        variable_name: str,
        variable_value: Any
    ) -> Optional[Environment]:
        """Update a single variable in an environment"""
        environment = await EnvironmentRepository.get_by_id(environment_id)
        if not environment:
            return None
        
        environment.variables[variable_name] = variable_value
        environment.updatedAt = datetime.now(UTC)
        await environment.save()
        
        return environment
    
    @staticmethod
    async def delete_variable(environment_id: str, variable_name: str) -> Optional[Environment]:
        """Delete a variable from an environment"""
        environment = await EnvironmentRepository.get_by_id(environment_id)
        if not environment:
            return None
        
        if variable_name in environment.variables:
            del environment.variables[variable_name]
            environment.updatedAt = datetime.now(UTC)
            await environment.save()
        
        return environment
    
    @staticmethod
    async def update_secret(
        environment_id: str,
        secret_name: str,
        secret_value: str
    ) -> Optional[Environment]:
        """Update a single secret in an environment"""
        environment = await EnvironmentRepository.get_by_id(environment_id)
        if not environment:
            return None
        
        environment.secrets[secret_name] = secret_value
        environment.updatedAt = datetime.now(UTC)
        await environment.save()
        
        return environment
    
    @staticmethod
    async def delete_secret(environment_id: str, secret_name: str) -> Optional[Environment]:
        """Delete a secret from an environment"""
        environment = await EnvironmentRepository.get_by_id(environment_id)
        if not environment:
            return None
        
        if secret_name in environment.secrets:
            del environment.secrets[secret_name]
            environment.updatedAt = datetime.now(UTC)
            await environment.save()
        
        return environment

    @staticmethod
    async def set_secret(
        environment_id: str, key: str, plaintext_value: str
    ) -> Environment:
        """Encrypt and store a secret value in the environment.

        The plaintext is encrypted with AES-256-GCM via the envelope
        encryption layer and stored as an :class:`EncryptedBlob` dict.
        """
        from app.services import secret_crypto

        environment = await EnvironmentRepository.get_by_id(environment_id)
        if environment is None:
            raise ValueError(f"Environment '{environment_id}' not found")

        blob = await secret_crypto.encrypt(plaintext_value)
        environment.secrets[key] = blob.model_dump()
        environment.updatedAt = datetime.now(UTC)
        await environment.save()
        return environment

    @staticmethod
    async def get_secret(environment_id: str, key: str) -> str | None:
        """Retrieve and decrypt a secret value from the environment.

        Returns *None* if the key does not exist.  Legacy plaintext values
        (stored before encryption was introduced) are returned as-is for
        backward compatibility.
        """
        from app.services import secret_crypto

        environment = await EnvironmentRepository.get_by_id(environment_id)
        if environment is None:
            return None

        raw = environment.secrets.get(key)
        if raw is None:
            return None

        if isinstance(raw, str):
            return raw

        blob = EncryptedBlob(**raw)
        return await secret_crypto.decrypt(blob)

    @staticmethod
    async def get_decrypted_secrets(environment_id: str) -> Dict[str, str]:
        """Retrieve and decrypt ALL secrets from an environment.

        Returns a ``Dict[str, str]`` mapping secret names to their plaintext
        values.  Legacy plaintext entries (stored before encryption was
        introduced) are returned as-is.  Encrypted entries (``EncryptedBlob``
        dicts) are decrypted via :func:`secret_crypto.decrypt`.

        Returns an empty dict if the environment does not exist or has no
        secrets.
        """
        from app.services import secret_crypto

        environment = await EnvironmentRepository.get_by_id(environment_id)
        if environment is None:
            return {}

        plaintext: Dict[str, str] = {}
        for key, raw in environment.secrets.items():
            if isinstance(raw, str):
                plaintext[key] = raw
            elif isinstance(raw, dict):
                blob = EncryptedBlob(**raw)
                plaintext[key] = await secret_crypto.decrypt(blob)
        return plaintext
