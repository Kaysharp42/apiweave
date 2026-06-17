/** Permission grant linking a team to a resource with specific permissions. */
export interface TeamPermissionGrant {
  grantId: string;
  teamId: string;
  orgId: string;
  resourceType: string;
  resourceId: string;
  permissions: string[];
  grantedBy: string;
  createdAt: string;
}
