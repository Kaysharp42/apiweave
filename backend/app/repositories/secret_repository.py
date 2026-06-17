"""
Repository layer for scoped secrets and secret bindings.

SecretRepository: CRUD for Secret documents (metadata + sealed-box ciphertext).
SecretBindingRepository: CRUD for SecretBinding documents (user-secret binding).
"""
from datetime import UTC, datetime

from app.models import Secret, SecretBinding


class SecretRepository:
    @staticmethod
    async def create(
        secret_id: str,
        name: str,
        scope_type: str,
        scope_id: str,
        ciphertext: str,
        key_id: str,
    ) -> Secret:
        now = datetime.now(UTC)
        secret = Secret(
            secretId=secret_id,
            name=name,
            scopeType=scope_type,
            scopeId=scope_id,
            ciphertext=ciphertext,
            keyId=key_id,
            createdAt=now,
            updatedAt=now,
        )
        await secret.insert()
        return secret

    @staticmethod
    async def get_by_id(secret_id: str) -> Secret | None:
        return await Secret.find_one(Secret.secretId == secret_id)

    @staticmethod
    async def get_by_scope_and_name(
        scope_type: str, scope_id: str, name: str
    ) -> Secret | None:
        return await Secret.find_one(
            Secret.scopeType == scope_type,
            Secret.scopeId == scope_id,
            Secret.name == name,
        )

    @staticmethod
    async def list_by_scope(scope_type: str, scope_id: str) -> list[Secret]:
        return await Secret.find(
            Secret.scopeType == scope_type,
            Secret.scopeId == scope_id,
        ).sort(Secret.name).to_list()

    @staticmethod
    async def count_by_scope(scope_type: str, scope_id: str) -> int:
        return await Secret.find(
            Secret.scopeType == scope_type,
            Secret.scopeId == scope_id,
        ).count()

    @staticmethod
    async def update(
        secret_id: str,
        ciphertext: str,
        key_id: str,
    ) -> Secret | None:
        """Update the ciphertext and keyId for an existing secret."""
        secret = await SecretRepository.get_by_id(secret_id)
        if not secret:
            return None
        secret.ciphertext = ciphertext
        secret.keyId = key_id
        secret.updatedAt = datetime.now(UTC)
        await secret.save()
        return secret

    @staticmethod
    async def delete(secret_id: str) -> bool:
        secret = await SecretRepository.get_by_id(secret_id)
        if not secret:
            return False
        await secret.delete()
        return True


class SecretBindingRepository:
    @staticmethod
    async def create(
        binding_id: str,
        secret_id: str,
        user_id: str,
        target_scope_type: str,
        target_scope_id: str,
    ) -> SecretBinding:
        now = datetime.now(UTC)
        binding = SecretBinding(
            bindingId=binding_id,
            secretId=secret_id,
            userId=user_id,
            targetScopeType=target_scope_type,
            targetScopeId=target_scope_id,
            createdAt=now,
        )
        await binding.insert()
        return binding

    @staticmethod
    async def get_by_id(binding_id: str) -> SecretBinding | None:
        return await SecretBinding.find_one(
            SecretBinding.bindingId == binding_id
        )

    @staticmethod
    async def list_for_target(
        target_scope_type: str, target_scope_id: str
    ) -> list[SecretBinding]:
        return await SecretBinding.find(
            SecretBinding.targetScopeType == target_scope_type,
            SecretBinding.targetScopeId == target_scope_id,
        ).to_list()

    @staticmethod
    async def list_for_user(user_id: str) -> list[SecretBinding]:
        return await SecretBinding.find(
            SecretBinding.userId == user_id,
        ).to_list()

    @staticmethod
    async def get_existing(
        secret_id: str,
        target_scope_type: str,
        target_scope_id: str,
    ) -> SecretBinding | None:
        """Check if a binding already exists for this secret+target combo."""
        return await SecretBinding.find_one(
            SecretBinding.secretId == secret_id,
            SecretBinding.targetScopeType == target_scope_type,
            SecretBinding.targetScopeId == target_scope_id,
        )

    @staticmethod
    async def delete(binding_id: str) -> bool:
        binding = await SecretBindingRepository.get_by_id(binding_id)
        if not binding:
            return False
        await binding.delete()
        return True
