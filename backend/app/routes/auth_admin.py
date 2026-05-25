from __future__ import annotations

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel

from app.auth.dependencies import require_permission
from app.auth.permissions import USERS_READ, USERS_UPDATE_ROLE
from app.models import User, UserResponse
from app.repositories.auth_repositories import UserRepository

router = APIRouter(prefix="/api", tags=["admin-users"])


class UpdateRolesRequest(BaseModel):
    roles: list[str]


def _user_response(user: User) -> UserResponse:
    return UserResponse(
        userId=user.userId,
        verified_email=user.verified_email,
        display_name=user.display_name,
        avatar_url=user.avatar_url,
        roles=user.roles,
        permissions=user.permissions,
        is_setup_complete=user.is_setup_complete,
        created_at=user.created_at,
    )


@router.get(
    "/users",
    response_model=list[UserResponse],
    dependencies=[require_permission(USERS_READ)],
)
async def list_users() -> list[UserResponse]:
    users = await UserRepository.get_all()
    return [_user_response(u) for u in users]


@router.patch(
    "/users/{user_id}/roles",
    response_model=UserResponse,
    dependencies=[require_permission(USERS_UPDATE_ROLE)],
)
async def update_user_roles(
    user_id: str,
    body: UpdateRolesRequest,
) -> UserResponse:
    updated = await UserRepository.update(user_id, roles=body.roles)
    if not updated:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )
    return _user_response(updated)

