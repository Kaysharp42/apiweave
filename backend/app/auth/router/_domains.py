"""Approved-domain CRUD routes and request/response models."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from fastapi import Depends, HTTPException, status
from pydantic import BaseModel

from app.auth.dependencies import get_current_user, require_permission
from app.auth.permissions import SETTINGS_READ, SETTINGS_UPDATE
from app.models import User
from app.repositories.auth_repositories import ApprovedDomainRepository

from ._router import router


class ApprovedDomainResponse(BaseModel):
    id: str
    domain: str
    created_by: str
    created_at: datetime


class AddDomainRequest(BaseModel):
    domain: str


@router.get(
    "/domains",
    response_model=list[ApprovedDomainResponse],
    dependencies=[require_permission(SETTINGS_READ)],
)
async def list_approved_domains() -> list[ApprovedDomainResponse]:
    domains = await ApprovedDomainRepository.list_all()
    return [
        ApprovedDomainResponse(
            id=d.domainId,
            domain=d.domain,
            created_by=d.created_by,
            created_at=d.created_at,
        )
        for d in domains
    ]


@router.post(
    "/domains",
    response_model=ApprovedDomainResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[require_permission(SETTINGS_UPDATE)],
)
async def add_approved_domain(
    body: AddDomainRequest,
    current_user: User = Depends(get_current_user),
) -> ApprovedDomainResponse:
    existing = await ApprovedDomainRepository.get_by_domain(body.domain.lower())
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Domain already approved",
        )
    now = datetime.now(UTC)
    domain = await ApprovedDomainRepository.create(
        domain_id=f"dom-{uuid.uuid4().hex[:12]}",
        domain=body.domain.lower(),
        created_by=current_user.userId,
        created_at=now,
    )
    return ApprovedDomainResponse(
        id=domain.domainId,
        domain=domain.domain,
        created_by=domain.created_by,
        created_at=domain.created_at,
    )


@router.delete(
    "/domains/{domain_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[require_permission(SETTINGS_UPDATE)],
)
async def remove_approved_domain(domain_id: str):
    deleted = await ApprovedDomainRepository.delete(domain_id)
    if not deleted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Domain not found",
        )
