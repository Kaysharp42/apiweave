import API_BASE_URL from "./api";
import type {
  ScopedWorkflowParams,
  ScopedEnvironmentParams,
  ScopedSecretParams,
} from "../types";

// ---------------------------------------------------------------------------
// Scoped URL builders
// ---------------------------------------------------------------------------

/**
 * Build a URL for listing or operating on workflows within a workspace.
 *
 * @param workspaceId - The workspace to scope to.
 * @param params      - Optional pagination parameters (defaults skip=0, limit=20).
 */
export function workflowsUrl(
  workspaceId: string,
  params?: Partial<ScopedWorkflowParams>,
): string {
  const skip = params?.skip ?? 0;
  const limit = params?.limit ?? 20;
  const attached = params?.includeAttached ? "&include_attached=true" : "";
  return `${API_BASE_URL}/api/workspaces/${encodeURIComponent(workspaceId)}/workflows?skip=${skip}&limit=${limit}${attached}`;
}

export function workflowUrl(workspaceId: string, workflowId: string): string {
  return `${API_BASE_URL}/api/workspaces/${encodeURIComponent(workspaceId)}/workflows/${encodeURIComponent(workflowId)}`;
}

/**
 * Build a URL for fetching environments at a given scope.
 *
 * Supports user (`/api/users/{scopeId}/environments`),
 * organization (`/api/orgs/{scopeId}/environments`), and
 * workspace (`/api/workspaces/{scopeId}/environments`) scopes.
 */
export function environmentsUrl(params: ScopedEnvironmentParams): string;
export function environmentsUrl(
  workspaceId: string,
  scope?: "workspace" | "all-accessible",
  orgId?: string | null,
): string;
export function environmentsUrl(
  paramsOrWorkspaceId: ScopedEnvironmentParams | string,
  scope: "workspace" | "all-accessible" = "workspace",
  orgId?: string | null,
): string {
  if (typeof paramsOrWorkspaceId === "string") {
    const base = `${API_BASE_URL}/api/workspaces/${encodeURIComponent(paramsOrWorkspaceId)}/environments`;
    if (scope === "all-accessible") {
      const orgQuery = orgId ? `?org_id=${encodeURIComponent(orgId)}` : "";
      return `${base}/all-accessible${orgQuery}`;
    }
    return base;
  }

  const { scopeType, scopeId } = paramsOrWorkspaceId;
  if (scopeType === "user") {
    return `${API_BASE_URL}/api/users/${encodeURIComponent(scopeId)}/environments`;
  }
  if (scopeType === "organization") {
    return `${API_BASE_URL}/api/orgs/${encodeURIComponent(scopeId)}/environments`;
  }
  return `${API_BASE_URL}/api/workspaces/${encodeURIComponent(scopeId)}/environments`;
}

/**
 * Build a URL for listing or operating on projects within a workspace.
 *
 * @param workspaceId - The workspace to scope to.
 * @param projectId   - Optional — when provided targets a specific project.
 */
export function projectsUrl(workspaceId: string, projectId?: string): string {
  const base = `${API_BASE_URL}/api/workspaces/${encodeURIComponent(workspaceId)}/projects`;
  if (projectId) {
    return `${base}/${encodeURIComponent(projectId)}`;
  }
  return base;
}

export function projectExportUrl(
  workspaceId: string,
  projectId: string,
  includeEnvironment = true,
): string {
  const include = encodeURIComponent(String(includeEnvironment));
  return `${projectsUrl(workspaceId, projectId)}/export?include_environment=${include}`;
}

export function projectImportUrl(workspaceId: string, dryRun = false): string {
  const suffix = dryRun ? "/import/dry-run" : "/import";
  return `${projectsUrl(workspaceId)}${suffix}`;
}

export function projectWorkflowAssignUrl(
  workspaceId: string,
  projectId: string,
  workflowId: string,
): string {
  return `${projectsUrl(workspaceId, projectId)}/workflows/${encodeURIComponent(workflowId)}/assign`;
}

export function projectWorkflowRemoveUrl(
  workspaceId: string,
  projectId: string,
  workflowId: string,
): string {
  return `${projectsUrl(workspaceId, projectId)}/workflows/${encodeURIComponent(workflowId)}`;
}

export function workflowsCreateInProjectUrl(
  workspaceId: string,
  projectId: string,
): string {
  return `${workflowsUrl(workspaceId)}&project_id=${encodeURIComponent(projectId)}`;
}

/**
 * Build a URL for listing or operating on secrets at a given scope.
 *
 * Scoped secrets live under `/api/scopes/{scopeType}/{scopeId}/secrets`.
 * When `secretId` is provided, targets a specific secret resource.
 */
export function secretsUrl(
  params: ScopedSecretParams,
  secretId?: string,
): string {
  const { scopeType, scopeId } = params;
  const base = `${API_BASE_URL}/api/scopes/${encodeURIComponent(scopeType)}/${encodeURIComponent(scopeId)}/secrets`;
  if (secretId) {
    return `${base}/${encodeURIComponent(secretId)}`;
  }
  return base;
}

/**
 * Build a URL for fetching the public key used to encrypt secret values
 * for a given scope.
 *
 * Route: `GET /api/secrets/public-key?scope={scopeType}&id={scopeId}`
 */
export function publicKeyUrl(scopeType: string, scopeId: string): string {
  return `${API_BASE_URL}/api/secrets/public-key?scope=${encodeURIComponent(scopeType)}&id=${encodeURIComponent(scopeId)}`;
}

// ---------------------------------------------------------------------------
// Workflow run / poll / history URL builders
// ---------------------------------------------------------------------------

/**
 * Build a URL for triggering a workflow run.
 *
 * POST `/api/workspaces/{ws}/workflows/{wf}/run?environmentId=...`
 */
export function workflowRunUrl(
  workspaceId: string,
  workflowId: string,
  environmentId?: string | null,
): string {
  const base = `${API_BASE_URL}/api/workspaces/${encodeURIComponent(workspaceId)}/workflows/${encodeURIComponent(workflowId)}/run`;
  if (environmentId) {
    return `${base}?environmentId=${encodeURIComponent(environmentId)}`;
  }
  return base;
}

/**
 * Build a URL for listing run history of a workflow.
 *
 * GET `/api/workspaces/{ws}/workflows/{wf}/runs?page=...&limit=...`
 */
export function workflowRunsListUrl(
  workspaceId: string,
  workflowId: string,
  page = 1,
  limit = 10,
): string {
  return `${API_BASE_URL}/api/workspaces/${encodeURIComponent(workspaceId)}/workflows/${encodeURIComponent(workflowId)}/runs?page=${page}&limit=${limit}`;
}

/**
 * Build a URL for fetching the latest failed run metadata.
 *
 * GET `/api/workspaces/{ws}/workflows/{wf}/runs/latest-failed`
 */
export function workflowLatestFailedUrl(
  workspaceId: string,
  workflowId: string,
): string {
  return `${API_BASE_URL}/api/workspaces/${encodeURIComponent(workspaceId)}/workflows/${encodeURIComponent(workflowId)}/runs/latest-failed`;
}

/**
 * Build a URL for fetching run status.
 *
 * GET `/api/workspaces/{ws}/workflows/{wf}/runs/{runId}`
 */
export function workflowRunStatusUrl(
  workspaceId: string,
  workflowId: string,
  runId: string,
): string {
  return `${API_BASE_URL}/api/workspaces/${encodeURIComponent(workspaceId)}/workflows/${encodeURIComponent(workflowId)}/runs/${encodeURIComponent(runId)}`;
}

/**
 * Build a URL for fetching a specific node result from a run.
 *
 * GET `/api/workspaces/{ws}/workflows/{wf}/runs/{runId}/nodes/{nodeId}/result`
 */
export function workflowNodeResultUrl(
  workspaceId: string,
  workflowId: string,
  runId: string,
  nodeId: string,
): string {
  return `${API_BASE_URL}/api/workspaces/${encodeURIComponent(workspaceId)}/workflows/${encodeURIComponent(workflowId)}/runs/${encodeURIComponent(runId)}/nodes/${encodeURIComponent(nodeId)}/result`;
}

/**
 * Build a URL for fetching or updating a single workflow.
 *
 * GET/PATCH/DELETE `/api/workspaces/{ws}/workflows/{wf}`
 */
export function workflowDetailUrl(
  workspaceId: string,
  workflowId: string,
): string {
  return `${API_BASE_URL}/api/workspaces/${encodeURIComponent(workspaceId)}/workflows/${encodeURIComponent(workflowId)}`;
}

// ---------------------------------------------------------------------------
// Composite helpers for common patterns
// ---------------------------------------------------------------------------

/**
 * Build a workflow list URL for the personal workspace.
 * Shorthand for `workflowsUrl(workspaceId, { skip: 0, limit: 20 })`.
 */
export function personalWorkflowsUrl(workspaceId: string): string {
  return workflowsUrl(workspaceId, { skip: 0, limit: 20 });
}

// ---------------------------------------------------------------------------
// Workflow import / export / templates URL builders
// ---------------------------------------------------------------------------

/**
 * Build a URL for importing a workflow bundle into a workspace.
 *
 * POST `/api/workspaces/{ws}/workflows/import`
 */
export function workflowImportUrl(workspaceId: string): string {
  return `${API_BASE_URL}/api/workspaces/${encodeURIComponent(workspaceId)}/workflows/import`;
}

/**
 * Build a URL for dry-running a workflow bundle import.
 *
 * POST `/api/workspaces/{ws}/workflows/import/dry-run`
 */
export function workflowImportDryRunUrl(workspaceId: string): string {
  return `${workflowImportUrl(workspaceId)}/dry-run`;
}

/**
 * Build a URL for importing HAR / OpenAPI / curl into a workspace.
 *
 * POST `/api/workspaces/{ws}/workflows/import/{format}`
 * POST `/api/workspaces/{ws}/workflows/import/{format}/dry-run`
 */
export function workflowImportFormatUrl(
  workspaceId: string,
  format: "har" | "openapi" | "curl",
  dryRun = false,
): string {
  const base = `${workflowImportUrl(workspaceId)}/${format}`;
  return dryRun ? `${base}/dry-run` : base;
}

/**
 * Build a URL for importing HAR into a workspace.
 *
 * POST `/api/workspaces/{ws}/workflows/import/har`
 * POST `/api/workspaces/{ws}/workflows/import/har/dry-run`
 */
export function workflowImportHarUrl(
  workspaceId: string,
  dryRun = false,
): string {
  return workflowImportFormatUrl(workspaceId, "har", dryRun);
}

/**
 * Build a URL for importing OpenAPI into a workspace.
 *
 * POST `/api/workspaces/{ws}/workflows/import/openapi`
 * POST `/api/workspaces/{ws}/workflows/import/openapi/dry-run`
 */
export function workflowImportOpenapiUrl(
  workspaceId: string,
  dryRun = false,
): string {
  return workflowImportFormatUrl(workspaceId, "openapi", dryRun);
}

/**
 * Build a base URL for the OpenAPI-from-remote-URL endpoint.
 *
 * GET `/api/workspaces/{ws}/workflows/import/openapi/url`
 *
 * Callers append `?swagger_url=...&sanitize=...` themselves.
 */
export function workflowImportOpenapiUrlUrl(workspaceId: string): string {
  return `${workflowImportUrl(workspaceId)}/openapi/url`;
}

/**
 * Build a URL for importing curl into a workspace.
 *
 * POST `/api/workspaces/{ws}/workflows/import/curl`
 * POST `/api/workspaces/{ws}/workflows/import/curl/dry-run`
 */
export function workflowImportCurlUrl(
  workspaceId: string,
  dryRun = false,
): string {
  return workflowImportFormatUrl(workspaceId, "curl", dryRun);
}

/**
 * Build a URL for fetching OpenAPI/Swagger from a remote URL.
 *
 * GET `/api/workspaces/{ws}/workflows/import/openapi/url`
 */
export function workflowImportOpenapiRemoteUrl(
  workspaceId: string,
  swaggerUrl: string,
  sanitize = true,
): string {
  const base = workflowImportOpenapiUrlUrl(workspaceId);
  const params = new URLSearchParams();
  params.set("swagger_url", swaggerUrl);
  params.set("sanitize", String(sanitize));
  return `${base}?${params.toString()}`;
}

/**
 * Build a URL for exporting a workflow bundle.
 *
 * GET `/api/workspaces/{ws}/workflows/{wf}/export`
 */
export function workflowExportUrl(
  workspaceId: string,
  workflowId: string,
  includeEnvironment = true,
): string {
  const base = `${workflowUrl(workspaceId, workflowId)}/export`;
  return `${base}?include_environment=${encodeURIComponent(String(includeEnvironment))}`;
}

/**
 * Build a URL for managing workflow templates.
 *
 * GET/POST/PUT/DELETE `/api/workspaces/{ws}/workflows/{wf}/templates`
 */
export function workflowTemplatesUrl(
  workspaceId: string,
  workflowId: string,
): string {
  return `${workflowUrl(workspaceId, workflowId)}/templates`;
}

// ---------------------------------------------------------------------------
// Webhook URL builders
// ---------------------------------------------------------------------------

/**
 * Build a URL for listing webhooks for a specific workflow resource.
 *
 * GET `/api/webhooks/workflows/{resourceId}`
 */
export function webhooksForWorkflowUrl(resourceId: string): string {
  return `${API_BASE_URL}/api/webhooks/workflows/${encodeURIComponent(resourceId)}`;
}

/**
 * Build a URL for listing webhooks for a specific project (collection) resource.
 *
 * GET `/api/webhooks/collections/{resourceId}`
 */
export function webhooksForProjectUrl(resourceId: string): string {
  return `${API_BASE_URL}/api/webhooks/collections/${encodeURIComponent(resourceId)}`;
}

/**
 * Build a URL for creating a webhook.
 *
 * POST `/api/webhooks`
 */
export function webhooksCreateUrl(): string {
  return `${API_BASE_URL}/api/webhooks`;
}

/**
 * Build a URL for CRUD operations on a specific webhook.
 *
 * GET/PATCH/DELETE `/api/webhooks/{webhookId}`
 */
export function webhookDetailUrl(webhookId: string): string {
  return `${API_BASE_URL}/api/webhooks/${encodeURIComponent(webhookId)}`;
}

/**
 * Build a URL for regenerating webhook credentials.
 *
 * POST `/api/webhooks/{webhookId}/regenerate-token`
 */
export function webhookRegenerateUrl(webhookId: string): string {
  return `${API_BASE_URL}/api/webhooks/${encodeURIComponent(webhookId)}/regenerate-token`;
}

/**
 * Build a URL for fetching webhook logs.
 *
 * GET `/api/webhooks/{webhookId}/logs?limit={limit}`
 */
export function webhookLogsUrl(webhookId: string, limit = 50): string {
  return `${API_BASE_URL}/api/webhooks/${encodeURIComponent(webhookId)}/logs?limit=${limit}`;
}
