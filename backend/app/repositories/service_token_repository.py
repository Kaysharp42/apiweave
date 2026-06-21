from datetime import UTC, datetime

from app.models import ServiceToken


class ServiceTokenRepository:
    @staticmethod
    async def create(
        token_id: str,
        name: str,
        token_hash: str,
        scope_type: str,
        scope_id: str,
        created_by: str,
        permissions: list[str] | None = None,
        expires_at: datetime | None = None,
        description: str | None = None,
    ) -> ServiceToken:
        now = datetime.now(UTC)
        token = ServiceToken(
            tokenId=token_id,
            name=name,
            tokenHash=token_hash,
            scopeType=scope_type,
            scopeId=scope_id,
            createdBy=created_by,
            permissions=permissions or [],
            createdAt=now,
            expiresAt=expires_at,
            description=description,
        )
        await token.insert()
        return token

    @staticmethod
    async def get_by_id(token_id: str) -> ServiceToken | None:
        return await ServiceToken.find_one(ServiceToken.tokenId == token_id)

    @staticmethod
    async def get_by_hash(token_hash: str) -> ServiceToken | None:
        return await ServiceToken.find_one(ServiceToken.tokenHash == token_hash)

    @staticmethod
    async def list_by_scope(scope_type: str, scope_id: str) -> list[ServiceToken]:
        return (
            await ServiceToken.find(
                ServiceToken.scopeType == scope_type,
                ServiceToken.scopeId == scope_id,
                ServiceToken.revokedAt == None,  # noqa: E711
            )
            .sort(-ServiceToken.createdAt)
            .to_list()
        )

    @staticmethod
    async def revoke(token_id: str) -> bool:
        token = await ServiceTokenRepository.get_by_id(token_id)
        if not token:
            return False
        token.revokedAt = datetime.now(UTC)
        await token.save()
        return True
