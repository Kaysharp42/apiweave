from datetime import datetime

from app.models import ApprovedDomain


class ApprovedDomainRepository:
    """Repository for ApprovedDomain operations"""

    @staticmethod
    async def create(
        domain_id: str,
        domain: str,
        created_by: str,
        created_at: datetime,
    ) -> ApprovedDomain:
        """Create and persist an approved domain"""
        approved = ApprovedDomain(
            domainId=domain_id,
            domain=domain,
            created_by=created_by,
            created_at=created_at,
        )
        await approved.insert()
        return approved

    @staticmethod
    async def get_by_domain(domain: str) -> ApprovedDomain | None:
        """Find approved domain by domain string"""
        return await ApprovedDomain.find_one(ApprovedDomain.domain == domain)

    @staticmethod
    async def is_domain_approved(domain: str) -> bool:
        """Return True if domain is in the approved list"""
        result = await ApprovedDomainRepository.get_by_domain(domain)
        return result is not None

    @staticmethod
    async def list_all() -> list[ApprovedDomain]:
        """Return all approved domains"""
        return await ApprovedDomain.find_all().to_list()

    @staticmethod
    async def delete(domain_id: str) -> bool:
        """Delete approved domain; returns True if deleted, False if not found"""
        approved = await ApprovedDomain.find_one(ApprovedDomain.domainId == domain_id)
        if not approved:
            return False
        await approved.delete()
        return True
