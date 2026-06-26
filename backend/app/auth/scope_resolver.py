from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from fastapi import Request

from app.auth.permissions import PermissionScope, permission
from app.repositories.organization_repository import OrganizationRepository
from app.repositories.outside_collaborator_repository import OutsideCollaboratorRepository
from app.repositories.team_permission_grant_repository import TeamPermissionGrantRepository
from app.repositories.team_repository import TeamRepository
from app.repositories.workspace_repository import WorkspaceRepository


@dataclass(frozen=True)
class ResolvedScope:
    resource: str
    action: str
    org_id: str | None = None
    workspace_id: str | None = None
    required_permission: str = field(init=False)

    def __post_init__(self) -> None:
        object.__setattr__(self, "required_permission", permission(self.resource, self.action))


class ResourceScopeResolver:
    @staticmethod
    def from_request(request: Request, resource: str, action: str) -> ResolvedScope:
        org_id = request.path_params.get("org_id") or request.path_params.get("org_slug")
        workspace_id = request.path_params.get("workspace_id") or request.path_params.get(
            "workspace_slug"
        )
        return ResolvedScope(
            resource=resource,
            action=action,
            org_id=str(org_id) if org_id else None,
            workspace_id=str(workspace_id) if workspace_id else None,
        )

    @staticmethod
    async def build_scope_context(
        user: Any,
        resolved: ResolvedScope,
    ) -> dict[str, Any]:
        """Hydrate the caller's roles/grants FOR THE RESOLVED SCOPE from the DB.

        The previous implementation read ``user.org_memberships`` etc., which the
        ``User`` document does not have, so every scoped check silently degraded
        to global-role-only (roadmap Bug A). Membership lives in its own
        collections; we look up only the records relevant to this one request's
        scope (no per-request full hydration, no N+1 over all memberships).
        """
        user_id = getattr(user, "userId", None)
        org_role: str | None = None
        workspace_role: str | None = None
        team_grants: list[set[str]] = []
        outside_collab_perms: set[str] | None = None
        service_token_perms: set[str] | None = None

        # Resolve the workspace doc once — needed for its role lookup AND to
        # derive the parent org of org-owned workspaces (routes carry only
        # {workspace_id}, never {org_slug}).
        workspace = None
        if resolved.workspace_id and user_id:
            workspace = await WorkspaceRepository.get_by_id(resolved.workspace_id)
            ws_member = await WorkspaceRepository.get_member(resolved.workspace_id, user_id)
            if ws_member is not None:
                workspace_role = ws_member.role

        # Resolve the org by id-or-slug from the path, else inherit from the
        # workspace's parent org. org_id path param holds a slug on most routes.
        org = None
        if user_id:
            if resolved.org_id:
                org = await OrganizationRepository.get_by_id(
                    resolved.org_id
                ) or await OrganizationRepository.get_by_slug(resolved.org_id)
            elif workspace is not None and getattr(workspace, "orgId", None):
                org = await OrganizationRepository.get_by_id(workspace.orgId)
            if org is not None:
                org_member = await OrganizationRepository.get_member(org.orgId, user_id)
                if org_member is not None:
                    org_role = org_member.role

        # Team grants targeting this workspace: teams live in the org, grants
        # are per-resource. Only grants on the resolved workspace apply here.
        if org is not None and resolved.workspace_id and user_id:
            teams = await TeamRepository.list_teams_for_user_in_org(user_id, org.orgId)
            team_ids = [t.teamId for t in teams]
            if team_ids:
                grants = await TeamPermissionGrantRepository.list_by_team_ids(team_ids)
                team_grants = [
                    set(g.permissions)
                    for g in grants
                    if g.resourceType == "workspace" and g.resourceId == resolved.workspace_id
                ]

        # Outside collaborator on this workspace (role → permission set).
        if resolved.workspace_id and user_id:
            outside_collab_perms = (
                await OutsideCollaboratorRepository.get_permissions_for_workspace(
                    resolved.workspace_id, user_id
                )
            )

        token_scope = getattr(user, "service_token_scope", None)
        if token_scope:
            service_token_perms = set(getattr(token_scope, "permissions", []))

        return {
            "org_role": org_role,
            "workspace_role": workspace_role,
            "team_grants": team_grants or None,
            "outside_collaborator_permissions": outside_collab_perms,
            "service_token_permissions": service_token_perms,
            "global_roles": getattr(user, "roles", []),
            "global_permissions": getattr(user, "permissions", []),
            "scope_source": PermissionScope.WORKSPACE_ROLE
            if workspace_role
            else PermissionScope.ORG_ROLE
            if org_role
            else PermissionScope.GLOBAL_ROLE,
        }
