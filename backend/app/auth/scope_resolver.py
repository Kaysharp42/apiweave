from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from fastapi import Request

from app.auth.permissions import PermissionScope, permission


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
    def build_scope_context(
        user: Any,
        resolved: ResolvedScope,
    ) -> dict[str, Any]:
        org_role: str | None = None
        workspace_role: str | None = None
        team_grants: list[set[str]] = []
        outside_collab_perms: set[str] | None = None
        service_token_perms: set[str] | None = None

        memberships = getattr(user, "org_memberships", None)
        if memberships:
            for membership in memberships:
                if resolved.org_id and getattr(membership, "org_id", None) == resolved.org_id:
                    org_role = getattr(membership, "role", None)
                    break

        ws_memberships = getattr(user, "workspace_memberships", None)
        if ws_memberships:
            for ws_membership in ws_memberships:
                if (
                    resolved.workspace_id
                    and getattr(ws_membership, "workspace_id", None) == resolved.workspace_id
                ):
                    workspace_role = getattr(ws_membership, "role", None)
                    break

        teams = getattr(user, "team_memberships", None)
        if teams:
            for team_membership in teams:
                grants = getattr(team_membership, "permission_grants", None)
                if grants:
                    team_grants.append(set(grants))

        outside_collab = getattr(user, "outside_collaborator_grants", None)
        if outside_collab and resolved.workspace_id:
            for grant in outside_collab:
                if getattr(grant, "workspace_id", None) == resolved.workspace_id:
                    outside_collab_perms = set(getattr(grant, "permissions", []))
                    break

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
