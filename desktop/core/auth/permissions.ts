/**
 * Permission vocabulary — ported from `backend/app/auth/permissions.py`.
 * Dropped resources: webhooks, users, settings (those subsystems are gone
 * with multi-tenant). Surviving resources: workflows, collections,
 * environments, runs, secrets. The seam stays so a future cloud/teams layer
 * can re-introduce users/settings/webhooks without re-architecting services.
 *
 * `permission(resource, action)` produces `"resource:action"` strings — the
 * shape every PermissionProvider implementation keys against. LocalOwnerProvider
 * ignores the value and always allows; cloud providers will match against
 * role presets.
 */

export const RESOURCE_WORKFLOWS = "workflows"
export const RESOURCE_COLLECTIONS = "collections"
export const RESOURCE_ENVIRONMENTS = "environments"
export const RESOURCE_RUNS = "runs"
export const RESOURCE_SECRETS = "secrets"

export type Resource =
  | typeof RESOURCE_WORKFLOWS
  | typeof RESOURCE_COLLECTIONS
  | typeof RESOURCE_ENVIRONMENTS
  | typeof RESOURCE_RUNS
  | typeof RESOURCE_SECRETS

export const ACTION_CREATE = "create"
export const ACTION_READ = "read"
export const ACTION_UPDATE = "update"
export const ACTION_DELETE = "delete"
export const ACTION_RUN = "run"
export const ACTION_EXPORT = "export"
export const ACTION_IMPORT = "import"
export const ACTION_SET_SECRET = "set_secret"
export const ACTION_CANCEL = "cancel"

export type Action =
  | typeof ACTION_CREATE
  | typeof ACTION_READ
  | typeof ACTION_UPDATE
  | typeof ACTION_DELETE
  | typeof ACTION_RUN
  | typeof ACTION_EXPORT
  | typeof ACTION_IMPORT
  | typeof ACTION_SET_SECRET
  | typeof ACTION_CANCEL

export function permission(resource: string, action: string): string {
  return `${resource}:${action}`
}

export const PERMISSIONS_BY_RESOURCE: Readonly<Record<Resource, readonly string[]>> = {
  workflows: [
    permission(RESOURCE_WORKFLOWS, ACTION_CREATE),
    permission(RESOURCE_WORKFLOWS, ACTION_READ),
    permission(RESOURCE_WORKFLOWS, ACTION_UPDATE),
    permission(RESOURCE_WORKFLOWS, ACTION_DELETE),
    permission(RESOURCE_WORKFLOWS, ACTION_RUN),
    permission(RESOURCE_WORKFLOWS, ACTION_EXPORT),
    permission(RESOURCE_WORKFLOWS, ACTION_IMPORT),
  ],
  collections: [
    permission(RESOURCE_COLLECTIONS, ACTION_CREATE),
    permission(RESOURCE_COLLECTIONS, ACTION_READ),
    permission(RESOURCE_COLLECTIONS, ACTION_UPDATE),
    permission(RESOURCE_COLLECTIONS, ACTION_DELETE),
    permission(RESOURCE_COLLECTIONS, ACTION_RUN),
    permission(RESOURCE_COLLECTIONS, ACTION_EXPORT),
    permission(RESOURCE_COLLECTIONS, ACTION_IMPORT),
  ],
  environments: [
    permission(RESOURCE_ENVIRONMENTS, ACTION_CREATE),
    permission(RESOURCE_ENVIRONMENTS, ACTION_READ),
    permission(RESOURCE_ENVIRONMENTS, ACTION_UPDATE),
    permission(RESOURCE_ENVIRONMENTS, ACTION_DELETE),
    permission(RESOURCE_ENVIRONMENTS, ACTION_SET_SECRET),
  ],
  runs: [
    permission(RESOURCE_RUNS, ACTION_READ),
    permission(RESOURCE_RUNS, ACTION_CANCEL),
  ],
  secrets: [
    permission(RESOURCE_SECRETS, ACTION_READ),
    permission(RESOURCE_SECRETS, ACTION_CREATE),
    permission(RESOURCE_SECRETS, ACTION_UPDATE),
    permission(RESOURCE_SECRETS, ACTION_DELETE),
  ],
}

export const ALL_PERMISSIONS: readonly string[] = Object.values(PERMISSIONS_BY_RESOURCE).flat()

export const ACTIONS_BY_RESOURCE: Readonly<Record<Resource, readonly string[]>> = {
  workflows: PERMISSIONS_BY_RESOURCE.workflows.map((p) => p.split(":")[1]!),
  collections: PERMISSIONS_BY_RESOURCE.collections.map((p) => p.split(":")[1]!),
  environments: PERMISSIONS_BY_RESOURCE.environments.map((p) => p.split(":")[1]!),
  runs: PERMISSIONS_BY_RESOURCE.runs.map((p) => p.split(":")[1]!),
  secrets: PERMISSIONS_BY_RESOURCE.secrets.map((p) => p.split(":")[1]!),
}

/** Workspace role hierarchy — kept for the cloud-provider seam. Local-only ignores it. */
export const WORKSPACE_ROLE_READ = "read"
export const WORKSPACE_ROLE_TRIAGE = "triage"
export const WORKSPACE_ROLE_WRITE = "write"
export const WORKSPACE_ROLE_MAINTAIN = "maintain"
export const WORKSPACE_ROLE_ADMIN = "admin"

export type WorkspaceRole =
  | typeof WORKSPACE_ROLE_READ
  | typeof WORKSPACE_ROLE_TRIAGE
  | typeof WORKSPACE_ROLE_WRITE
  | typeof WORKSPACE_ROLE_MAINTAIN
  | typeof WORKSPACE_ROLE_ADMIN

export const WORKSPACE_ROLE_HIERARCHY: readonly WorkspaceRole[] = [
  WORKSPACE_ROLE_READ,
  WORKSPACE_ROLE_TRIAGE,
  WORKSPACE_ROLE_WRITE,
  WORKSPACE_ROLE_MAINTAIN,
  WORKSPACE_ROLE_ADMIN,
]

export const WORKSPACE_ROLE_PERMISSIONS: Readonly<Record<WorkspaceRole, readonly string[]>> = {
  read: [
    permission(RESOURCE_WORKFLOWS, ACTION_READ),
    permission(RESOURCE_COLLECTIONS, ACTION_READ),
    permission(RESOURCE_ENVIRONMENTS, ACTION_READ),
    permission(RESOURCE_RUNS, ACTION_READ),
    permission(RESOURCE_SECRETS, ACTION_READ),
  ],
  triage: [
    permission(RESOURCE_WORKFLOWS, ACTION_READ),
    permission(RESOURCE_WORKFLOWS, ACTION_RUN),
    permission(RESOURCE_COLLECTIONS, ACTION_READ),
    permission(RESOURCE_COLLECTIONS, ACTION_RUN),
    permission(RESOURCE_ENVIRONMENTS, ACTION_READ),
    permission(RESOURCE_RUNS, ACTION_READ),
    permission(RESOURCE_SECRETS, ACTION_READ),
  ],
  write: [
    permission(RESOURCE_WORKFLOWS, ACTION_READ),
    permission(RESOURCE_WORKFLOWS, ACTION_CREATE),
    permission(RESOURCE_WORKFLOWS, ACTION_UPDATE),
    permission(RESOURCE_WORKFLOWS, ACTION_DELETE),
    permission(RESOURCE_WORKFLOWS, ACTION_RUN),
    permission(RESOURCE_COLLECTIONS, ACTION_READ),
    permission(RESOURCE_COLLECTIONS, ACTION_CREATE),
    permission(RESOURCE_COLLECTIONS, ACTION_UPDATE),
    permission(RESOURCE_COLLECTIONS, ACTION_DELETE),
    permission(RESOURCE_COLLECTIONS, ACTION_RUN),
    permission(RESOURCE_ENVIRONMENTS, ACTION_READ),
    permission(RESOURCE_ENVIRONMENTS, ACTION_CREATE),
    permission(RESOURCE_ENVIRONMENTS, ACTION_UPDATE),
    permission(RESOURCE_RUNS, ACTION_READ),
    permission(RESOURCE_SECRETS, ACTION_READ),
  ],
  maintain: [
    permission(RESOURCE_WORKFLOWS, ACTION_READ),
    permission(RESOURCE_WORKFLOWS, ACTION_CREATE),
    permission(RESOURCE_WORKFLOWS, ACTION_UPDATE),
    permission(RESOURCE_WORKFLOWS, ACTION_DELETE),
    permission(RESOURCE_WORKFLOWS, ACTION_RUN),
    permission(RESOURCE_WORKFLOWS, ACTION_EXPORT),
    permission(RESOURCE_WORKFLOWS, ACTION_IMPORT),
    permission(RESOURCE_COLLECTIONS, ACTION_READ),
    permission(RESOURCE_COLLECTIONS, ACTION_CREATE),
    permission(RESOURCE_COLLECTIONS, ACTION_UPDATE),
    permission(RESOURCE_COLLECTIONS, ACTION_DELETE),
    permission(RESOURCE_COLLECTIONS, ACTION_RUN),
    permission(RESOURCE_COLLECTIONS, ACTION_EXPORT),
    permission(RESOURCE_COLLECTIONS, ACTION_IMPORT),
    permission(RESOURCE_ENVIRONMENTS, ACTION_READ),
    permission(RESOURCE_ENVIRONMENTS, ACTION_CREATE),
    permission(RESOURCE_ENVIRONMENTS, ACTION_UPDATE),
    permission(RESOURCE_RUNS, ACTION_READ),
    permission(RESOURCE_SECRETS, ACTION_READ),
  ],
  admin: ALL_PERMISSIONS,
}

/** Higher role in the hierarchy wins (admin > maintain > write > triage > read). */
export function higherWorkspaceRole(a: WorkspaceRole, b: WorkspaceRole): WorkspaceRole {
  const ia = WORKSPACE_ROLE_HIERARCHY.indexOf(a)
  const ib = WORKSPACE_ROLE_HIERARCHY.indexOf(b)
  return ia >= ib ? a : b
}

export function effectiveWorkspaceRole(
  direct: WorkspaceRole | undefined,
  team: readonly WorkspaceRole[] | undefined,
  outsideCollab: WorkspaceRole | undefined,
): WorkspaceRole | undefined {
  const candidates: WorkspaceRole[] = []
  if (direct) candidates.push(direct)
  if (team) candidates.push(...team)
  if (outsideCollab) candidates.push(outsideCollab)
  if (candidates.length === 0) return undefined
  return candidates.reduce(higherWorkspaceRole)
}

export function permissionsForWorkspaceRole(role: WorkspaceRole): readonly string[] {
  return WORKSPACE_ROLE_PERMISSIONS[role] ?? []
}

export function permissionDeniedDetail(required: string): string {
  return `Missing required permission: ${required}`
}
