import { createApiweaveClient } from "../../../shared/contract/client";
import type {
  ContractErrorCode,
  ContractResult,
} from "../../../shared/contract/errors";
import type { RunProgressEvent } from "../../../shared/types/RunProgressEvent";
import type { McpStatus } from "../../../shared/types/McpStatus";
import type { MCPTool } from "../../../shared/types/MCPTool";
import type { AuthenticatedRequestInit } from "../types";
import type { Project } from "../types/Project";
import type { DryRunResult } from "../types/DryRunResult";
import type { ImportResult } from "../types/ImportResult";
import type { Run } from "../types/Run";
import type { ScopedEnvironment } from "../types/ScopedEnvironment";
import type { Workflow } from "../types/Workflow";
import type { Workspace } from "../types/Workspace";

type Environment = ScopedEnvironment;
type ImportDryRunResult = DryRunResult;
type JsonValue = unknown;
type IpcRun = Run & {
  readonly workspaceId?: string;
  readonly selectedEnvironmentId?: string | null;
  readonly failedNodes?: readonly string[] | null;
  readonly nodeStatuses?: Record<string, JsonValue>;
  readonly variables?: Record<string, JsonValue>;
};

type IpcBridge = {
  readonly invoke: (
    domain: string,
    action: string,
    payload: unknown,
  ) => Promise<ContractResult<unknown>>;
  readonly onRunProgress: (
    runId: string,
    callback: (event: RunProgressEvent) => void,
  ) => () => void;
};

type DesktopBridge = {
  readonly minimize: () => void;
  readonly toggleMaximize: () => void;
  readonly close: () => void;
  readonly onMaximizeChange: (
    callback: (isMaximized: boolean) => void,
  ) => () => void;
};

type McpBridge = {
  readonly getStatus: () => Promise<McpStatus>;
  readonly enable: () => Promise<McpStatus>;
  readonly disable: () => Promise<McpStatus>;
  readonly listTools: () => Promise<readonly MCPTool[]>;
};

declare global {
  interface Window {
    __APIWEAVE_IPC__?: IpcBridge;
    __APIWEAVE_DESKTOP__?: DesktopBridge;
    __APIWEAVE_MCP__?: McpBridge;
    __APIWEAVE_RUNTIME__?: {
      readonly apiUrl?: string;
      readonly uiToken?: string;
    };
    apiweave?: typeof apiweave;
  }

  interface ImportMeta {
    readonly env: {
      readonly VITE_APP_VERSION?: string;
      readonly VITE_API_URL?: string;
    };
  }
}

type GlobalWithApiweave = typeof globalThis & {
  __APIWEAVE_IPC__?: IpcBridge;
  __APIWEAVE_DESKTOP__?: DesktopBridge;
  __APIWEAVE_MCP__?: McpBridge;
};

type ListResult<T> = { readonly items: readonly T[]; readonly total: number };
type WorkflowPatch = Partial<
  Omit<
    Workflow,
    "workspaceId" | "workflowId" | "rev" | "createdAt" | "updatedAt"
  >
>;
type CollectionPatch = Partial<
  Omit<
    Project,
    "workspaceId" | "collectionId" | "rev" | "createdAt" | "updatedAt"
  >
>;
type EnvironmentPatch = Partial<
  Omit<
    Environment,
    "workspaceId" | "environmentId" | "rev" | "createdAt" | "updatedAt"
  >
>;
type ProjectBundle = Record<
  string,
  JsonValue | readonly JsonValue[] | undefined
>;
type SecretScopeType = "environment" | "workspace";
type SecretMetadata = {
  readonly secretId: string;
  readonly name: string;
  readonly scopeType: SecretScopeType;
  readonly scopeId: string;
  readonly keyId: string;
  readonly label?: string;
};
type ResolvedSecret = {
  readonly metadata: SecretMetadata;
  readonly resolvedScope: SecretScopeType;
};
type SecretPublicKey = {
  readonly keyId: string;
  readonly publicKey: string;
  readonly algorithm: "libsodium-sealed-box";
};

export class IpcError extends Error {
  readonly code: ContractErrorCode;
  readonly details?: unknown;

  constructor(code: ContractErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "IpcError";
    this.code = code;
    this.details = details;
  }
}

const globalApiweave = globalThis as GlobalWithApiweave;

function getIpcBridge(): IpcBridge {
  const bridge =
    globalThis.window?.__APIWEAVE_IPC__ ?? globalApiweave.__APIWEAVE_IPC__;
  if (!bridge) {
    throw new IpcError("denied", "APIWeave IPC bridge is not available");
  }
  return bridge;
}

export const ipcClient = createApiweaveClient((domain, action, payload) =>
  getIpcBridge().invoke(domain, action, payload),
);

export async function invoke<T>(
  domain: string,
  action: string,
  payload?: unknown,
): Promise<T> {
  const result = (await ipcClient[domain]?.[action]?.(payload)) as
    | ContractResult<T>
    | undefined;
  if (!result) {
    throw new IpcError(
      "not_found",
      `No IPC client method: ${domain}.${action}`,
    );
  }
  if (result.ok) return result.data;
  throw new IpcError(
    result.error.code,
    result.error.message,
    result.error.details,
  );
}

export const apiweave = {
  workspaces: {
    list: () => invoke<readonly Workspace[]>("workspaces", "list", {}),
    create: (
      input: Pick<Workspace, "name"> &
        Partial<Pick<Workspace, "slug" | "description" | "isPersonal">>,
    ) => invoke<Workspace>("workspaces", "create", input),
    get: (workspaceId: string) =>
      invoke<Workspace>("workspaces", "get", { workspaceId }),
    update: (
      workspaceId: string,
      patch: Partial<
        Pick<Workspace, "name" | "slug" | "description" | "isPersonal">
      >,
    ) => invoke<Workspace>("workspaces", "update", { workspaceId, ...patch }),
    delete: (workspaceId: string) =>
      invoke<null>("workspaces", "delete", { workspaceId }),
  },
  workflows: {
    create: (
      input: { readonly workspaceId: string } & WorkflowPatch &
        Pick<Workflow, "name">,
    ) => invoke<Workflow>("workflows", "create", input),
    get: (workspaceId: string, workflowId: string) =>
      invoke<Workflow>("workflows", "get", { workspaceId, workflowId }),
    list: (workspaceId: string, includeAttached?: boolean) =>
      invoke<ListResult<Workflow>>("workflows", "list", {
        workspaceId,
        includeAttached,
      }),
    update: (workspaceId: string, workflowId: string, patch: WorkflowPatch) =>
      invoke<Workflow>("workflows", "update", {
        workspaceId,
        workflowId,
        ...patch,
      }),
    delete: (workspaceId: string, workflowId: string) =>
      invoke<null>("workflows", "delete", { workspaceId, workflowId }),
    attachToCollection: (
      workspaceId: string,
      workflowId: string,
      collectionId: string | null,
    ) =>
      invoke<Workflow>("workflows", "attachToCollection", {
        workspaceId,
        workflowId,
        collectionId,
      }),
    setEnvironment: (
      workspaceId: string,
      workflowId: string,
      environmentId: string | null,
    ) =>
      invoke<Workflow>("workflows", "setEnvironment", {
        workspaceId,
        workflowId,
        environmentId,
      }),
    import: (
      workspaceId: string,
      bundle: unknown,
      createMissingEnvironments?: boolean,
    ) =>
      invoke<ImportResult>("workflows", "import", {
        workspaceId,
        bundle,
        createMissingEnvironments,
      }),
    dryRun: (workspaceId: string, bundle: unknown) =>
      invoke<DryRunResult>("workflows", "dryRun", { workspaceId, bundle }),
  },
  environments: {
    create: (
      input: { readonly workspaceId: string } & EnvironmentPatch &
        Pick<Environment, "name">,
    ) => invoke<Environment>("environments", "create", input),
    get: (workspaceId: string, environmentId: string) =>
      invoke<Environment>("environments", "get", {
        workspaceId,
        environmentId,
      }),
    list: (workspaceId: string) =>
      invoke<ListResult<Environment>>("environments", "list", { workspaceId }),
    update: (
      workspaceId: string,
      environmentId: string,
      patch: EnvironmentPatch,
    ) =>
      invoke<Environment>("environments", "update", {
        workspaceId,
        environmentId,
        ...patch,
      }),
    delete: (workspaceId: string, environmentId: string) =>
      invoke<null>("environments", "delete", { workspaceId, environmentId }),
    setVariable: (
      workspaceId: string,
      environmentId: string,
      name: string,
      value: JsonValue,
    ) =>
      invoke<Environment>("environments", "setVariable", {
        workspaceId,
        environmentId,
        name,
        value,
      }),
    deleteVariable: (
      workspaceId: string,
      environmentId: string,
      name: string,
    ) =>
      invoke<Environment>("environments", "deleteVariable", {
        workspaceId,
        environmentId,
        name,
      }),
  },
  runs: {
    create: (
      input: {
        readonly workspaceId: string;
        readonly workflowId: string;
      } & Partial<IpcRun>,
    ) => invoke<IpcRun>("runs", "create", input),
    get: (workspaceId: string, runId: string) =>
      invoke<IpcRun>("runs", "get", { workspaceId, runId }),
    listByWorkflow: (workspaceId: string, workflowId: string) =>
      invoke<ListResult<IpcRun>>("runs", "listByWorkflow", {
        workspaceId,
        workflowId,
      }),
    listByWorkspace: (workspaceId: string) =>
      invoke<ListResult<IpcRun>>("runs", "listByWorkspace", { workspaceId }),
    getLatest: (workspaceId: string, workflowId: string) =>
      invoke<IpcRun | null>("runs", "getLatest", { workspaceId, workflowId }),
    getLatestFailed: (workspaceId: string, workflowId: string) =>
      invoke<IpcRun | null>("runs", "getLatestFailed", {
        workspaceId,
        workflowId,
      }),
    cancel: (workspaceId: string, runId: string) =>
      invoke<IpcRun>("runs", "cancel", { workspaceId, runId }),
    getArtifacts: (runId: string) =>
      invoke<unknown>("runs", "getArtifacts", { runId }),
    openArtifact: (path: string) =>
      invoke<string>("runs", "openArtifact", { path }),
    saveArtifactAs: (
      runId: string,
      artifactName: "junit.xml" | "report.html",
    ) =>
      invoke<string | null>("runs", "saveArtifactAs", { runId, artifactName }),
  },
  secrets: {
    set: (input: {
      readonly workspaceId: string;
      readonly name: string;
      readonly scopeType: SecretScopeType;
      readonly scopeId: string;
      readonly keyId: string;
      readonly sealed: Uint8Array;
      readonly label?: string;
    }) => invoke<SecretMetadata>("secrets", "set", input),
    publicKey: (
      workspaceId: string,
      scopeType: SecretScopeType,
      scopeId: string,
    ) =>
      invoke<SecretPublicKey>("secrets", "publicKey", {
        workspaceId,
        scopeType,
        scopeId,
      }),
    list: (workspaceId: string, scopeType: SecretScopeType, scopeId: string) =>
      invoke<readonly SecretMetadata[]>("secrets", "list", {
        workspaceId,
        scopeType,
        scopeId,
      }),
    delete: (
      workspaceId: string,
      scopeType: SecretScopeType,
      scopeId: string,
      name: string,
    ) =>
      invoke<null>("secrets", "delete", {
        workspaceId,
        scopeType,
        scopeId,
        name,
      }),
    resolve: (
      workspaceId: string,
      chain: { readonly environmentId?: string; readonly workspaceId?: string },
      name: string,
    ) =>
      invoke<ResolvedSecret | null>("secrets", "resolve", {
        workspaceId,
        chain,
        name,
      }),
  },
  projects: {
    create: (
      input: { readonly workspaceId: string } & Partial<Project> &
        Pick<Project, "name">,
    ) => invoke<Project>("projects", "create", input),
    get: (workspaceId: string, collectionId: string) =>
      invoke<Project>("projects", "get", { workspaceId, collectionId }),
    list: (workspaceId: string) =>
      invoke<ListResult<Project>>("projects", "list", { workspaceId }),
    update: (
      workspaceId: string,
      collectionId: string,
      patch: CollectionPatch,
    ) =>
      invoke<Project>("projects", "update", {
        workspaceId,
        collectionId,
        ...patch,
      }),
    delete: (workspaceId: string, collectionId: string) =>
      invoke<null>("projects", "delete", { workspaceId, collectionId }),
    addWorkflow: (
      workspaceId: string,
      collectionId: string,
      workflowId: string,
    ) =>
      invoke<Workflow>("projects", "addWorkflow", {
        workspaceId,
        collectionId,
        workflowId,
      }),
    removeWorkflow: (
      workspaceId: string,
      collectionId: string,
      workflowId: string,
    ) =>
      invoke<Workflow>("projects", "removeWorkflow", {
        workspaceId,
        collectionId,
        workflowId,
      }),
    listWorkflows: (workspaceId: string, collectionId: string) =>
      invoke<readonly Workflow[]>("projects", "listWorkflows", {
        workspaceId,
        collectionId,
      }),
    export: (workspaceId: string, projectId: string) =>
      invoke<ProjectBundle>("projects", "export", { workspaceId, projectId }),
    import: (workspaceId: string, bundle: ProjectBundle) =>
      invoke<unknown>("projects", "import", { workspaceId, bundle }),
    dryRun: (workspaceId: string, bundle: ProjectBundle) =>
      invoke<ImportDryRunResult>("projects", "dryRun", { workspaceId, bundle }),
  },
} as const;

if (typeof window !== "undefined") {
  window.apiweave = apiweave;
}

export function onRunProgress(
  runId: string,
  callback: (event: RunProgressEvent) => void,
): () => void {
  return getIpcBridge().onRunProgress(runId, callback);
}

function getDesktopBridge(): DesktopBridge | undefined {
  return (
    globalThis.window?.__APIWEAVE_DESKTOP__ ??
    globalApiweave.__APIWEAVE_DESKTOP__
  );
}

export const desktop = {
  minimize: () => getDesktopBridge()?.minimize(),
  toggleMaximize: () => getDesktopBridge()?.toggleMaximize(),
  close: () => getDesktopBridge()?.close(),
  onMaximizeChange: (callback: (isMaximized: boolean) => void) =>
    getDesktopBridge()?.onMaximizeChange(callback) ?? (() => undefined),
} as const;

function getMcpBridge(): McpBridge | undefined {
  return globalThis.window?.__APIWEAVE_MCP__ ?? globalApiweave.__APIWEAVE_MCP__;
}

/** Controls for the opt-in loopback MCP server (Setup-MCP dialog). Returns null
 * status when the bridge is absent (e.g. web preview outside Electron). */
export const mcp = {
  isAvailable: (): boolean => getMcpBridge() !== undefined,
  getStatus: (): Promise<McpStatus> =>
    getMcpBridge()?.getStatus() ??
    Promise.resolve({ running: false, config: null }),
  enable: (): Promise<McpStatus> =>
    getMcpBridge()?.enable() ??
    Promise.resolve({ running: false, config: null }),
  disable: (): Promise<McpStatus> =>
    getMcpBridge()?.disable() ??
    Promise.resolve({ running: false, config: null }),
  listTools: (): Promise<readonly MCPTool[]> =>
    getMcpBridge()?.listTools() ?? Promise.resolve([]),
} as const;

export const API_BASE_URL = "ipc://apiweave";
export default API_BASE_URL;

const ok = (data: unknown, init?: ResponseInit): Response =>
  new Response(JSON.stringify(data), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });

const noContent = (): Response => new Response(null, { status: 204 });

const fail = (error: unknown): Response => {
  if (error instanceof IpcError) {
    const detailStatus =
      typeof error.details === "object" &&
      error.details !== null &&
      "status" in error.details
        ? Number((error.details as { readonly status?: unknown }).status)
        : undefined;
    const status =
      detailStatus ??
      (error.code === "not_found" ? 404 : error.code === "denied" ? 403 : 400);
    return ok(
      { detail: error.message, code: error.code, details: error.details },
      { status },
    );
  }
  const message = error instanceof Error ? error.message : "IPC request failed";
  return ok({ detail: message }, { status: 500 });
};

function parsePayload(options: AuthenticatedRequestInit): unknown {
  if (typeof options.body !== "string" || options.body.trim() === "")
    return undefined;
  try {
    return JSON.parse(options.body) as unknown;
  } catch {
    return options.body;
  }
}

const readFormFileText = async (
  options: AuthenticatedRequestInit,
  field: string,
): Promise<string> => {
  if (!(options.body instanceof FormData)) return "";
  const file = options.body.get(field);
  return file instanceof File ? file.text() : "";
};

const parseImportBool = (params: URLSearchParams, name: string): boolean | undefined => {
  const value = params.get(name);
  return value === null ? undefined : value === "true";
};

const readPath = (
  input: string | URL | Request,
): { readonly path: string; readonly params: URLSearchParams } => {
  const raw = input instanceof Request ? input.url : String(input);
  const url = new URL(raw, API_BASE_URL);
  return { path: url.pathname, params: url.searchParams };
};

const segment = (parts: readonly string[], index: number): string =>
  decodeURIComponent(parts[index] ?? "");

type WorkspaceCreateInput = Pick<Workspace, "name"> &
  Partial<Pick<Workspace, "slug" | "description" | "isPersonal">>;

function workspaceCreateInput(payload: unknown): WorkspaceCreateInput {
  if (
    typeof payload === "object" &&
    payload !== null &&
    "name" in payload &&
    typeof payload.name === "string"
  ) {
    return {
      name: payload.name,
      ...("slug" in payload && typeof payload.slug === "string"
        ? { slug: payload.slug }
        : {}),
      ...("description" in payload && typeof payload.description === "string"
        ? { description: payload.description }
        : {}),
      ...("isPersonal" in payload && typeof payload.isPersonal === "boolean"
        ? { isPersonal: payload.isPersonal }
        : {}),
    };
  }
  return { name: "Personal" };
}

function base64ToBytes(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
}

export async function authenticatedFetch(
  input: string | URL | Request,
  options: AuthenticatedRequestInit = {},
): Promise<Response> {
  const testFetch = (globalThis as { readonly fetch?: unknown }).fetch;
  if (typeof testFetch === "function" && "_isMockFunction" in testFetch) {
    const mockedFetch = testFetch as unknown as (
      input: string | URL | Request,
      init?: RequestInit,
    ) => Promise<Response>;
    return mockedFetch(input, { credentials: "include", ...options });
  }

  const method = (options.method ?? "GET").toUpperCase();
  const { path, params } = readPath(input);
  const parts = path.split("/").filter(Boolean);
  const payload = parsePayload(options);

  try {
    if (
      parts[0] === "api" &&
      parts[1] === "auth" &&
      parts[2] === "me" &&
      method === "GET"
    ) {
      return ok(await invoke<unknown>("auth", "me", {}));
    }

    if (
      parts[0] === "api" &&
      parts[1] === "auth" &&
      parts[2] === "mode" &&
      method === "GET"
    ) {
      return ok(await invoke<unknown>("auth", "mode", {}));
    }

    if (
      parts[0] === "api" &&
      parts[1] === "auth" &&
      parts[2] === "logout" &&
      method === "POST"
    ) {
      return ok(await invoke<unknown>("auth", "logout", {}));
    }

    if (
      parts[0] === "api" &&
      parts[1] === "auth" &&
      parts[2] === "email" &&
      parts[3] === "request" &&
      method === "POST"
    ) {
      return ok(
        await invoke<unknown>("auth", "requestEmailLink", payload ?? {}),
      );
    }

    if (
      parts[0] === "api" &&
      parts[1] === "orgs" &&
      parts.length === 2 &&
      method === "POST"
    ) {
      return ok(await invoke<unknown>("orgs", "create", payload ?? {}));
    }

    if (parts[0] === "api" && parts[1] === "workspaces") {
      if (parts.length === 2 && method === "GET") {
        const workspaces = await apiweave.workspaces.list();
        return ok({ workspaces, total: workspaces.length });
      }
      if (parts.length === 2 && method === "POST") {
        return ok(
          await apiweave.workspaces.create(workspaceCreateInput(payload)),
        );
      }

      const workspaceId = segment(parts, 2);
      if (parts[3] === "workflows") {
        if (parts.length === 4 && method === "GET") {
          const data = await apiweave.workflows.list(
            workspaceId,
            params.get("include_attached") === "true",
          );
          return ok({ workflows: data.items, total: data.total });
        }
        if (parts.length === 4 && method === "POST") {
          const projectId = params.get("project_id");
          const body = (payload ?? {}) as WorkflowPatch &
            Pick<Workflow, "name">;
          const collectionId = projectId ?? body.collectionId;
          const workflow = await apiweave.workflows.create(
            collectionId
              ? { workspaceId, ...body, collectionId }
              : { workspaceId, ...body },
          );
          return ok(workflow);
        }
        if (parts[4] === "import" && parts[5] === "openapi" && parts[6] === "url" && ["GET", "POST"].includes(method)) {
          return ok(
            await invoke<unknown>("workflows", "importOpenapiUrl", {
              workspaceId,
              url: params.get("swagger_url") ?? params.get("url") ?? "",
              baseUrl: params.get("base_url") ?? undefined,
              tagFilter: params.get("tag_filter")?.split(",").filter(Boolean),
              sanitize: parseImportBool(params, "sanitize"),
              dryRun: parts[7] === "dry-run",
            }),
          );
        }
        if (parts[4] === "import" && parts[5] === "openapi" && method === "POST") {
          const spec = await readFormFileText(options, "file");
          return ok(
            await invoke<unknown>("workflows", "importOpenapi", {
              workspaceId,
              spec,
              baseUrl: params.get("base_url") ?? undefined,
              tagFilter: params.get("tag_filter")?.split(",").filter(Boolean),
              sanitize: parseImportBool(params, "sanitize"),
              dryRun: parts[6] === "dry-run",
            }),
          );
        }
        if (parts[4] === "import" && parts[5] === "har" && method === "POST") {
          const text = await readFormFileText(options, "file");
          return ok(
            await invoke<unknown>("workflows", "importHar", {
              workspaceId,
              data: JSON.parse(text) as Record<string, unknown>,
              importMode: params.get("import_mode") ?? undefined,
              sanitize: parseImportBool(params, "sanitize"),
              dryRun: parts[6] === "dry-run",
            }),
          );
        }
        if (parts[4] === "import" && parts[5] === "curl" && method === "POST") {
          return ok(
            await invoke<unknown>("workflows", "importCurl", {
              workspaceId,
              curlCommand: params.get("curl_command") ?? "",
              sanitize: parseImportBool(params, "sanitize"),
              dryRun: parts[6] === "dry-run",
              workflowId: params.get("workflowId") ?? undefined,
              collectionId: params.get("collectionId") ?? undefined,
            }),
          );
        }
        if (parts[4] === "import") {
          const body = (payload ?? {}) as {
            readonly bundle?: unknown;
            readonly createMissingEnvironments?: boolean;
            readonly sanitize?: boolean;
          };
          const bundle = body.bundle ?? body;
          return ok(
            parts[5] === "dry-run"
              ? await apiweave.workflows.dryRun(workspaceId, bundle)
              : await invoke<ImportResult>("workflows", "import", {
                  workspaceId,
                  bundle,
                  createMissingEnvironments: body.createMissingEnvironments,
                  sanitize: body.sanitize,
                }),
          );
        }
        const workflowId = segment(parts, 4);
        if (parts.length === 5 && method === "GET")
          return ok(await apiweave.workflows.get(workspaceId, workflowId));
        if (parts.length === 5 && ["PUT", "PATCH"].includes(method)) {
          return ok(
            await apiweave.workflows.update(
              workspaceId,
              workflowId,
              (payload ?? {}) as WorkflowPatch,
            ),
          );
        }
        if (parts.length === 5 && method === "DELETE") {
          await apiweave.workflows.delete(workspaceId, workflowId);
          return noContent();
        }
        if (parts[5] === "run" && method === "POST") {
          const body = (payload ?? {}) as Partial<Run>;
          return ok(
            await apiweave.runs.create({
              workspaceId,
              workflowId,
              ...body,
              selectedEnvironmentId: params.get("environmentId") ?? null,
            }),
            { status: 202 },
          );
        }
        if (parts[5] === "runs" && parts.length === 6 && method === "GET") {
          const data = await apiweave.runs.listByWorkflow(
            workspaceId,
            workflowId,
          );
          return ok({ runs: data.items, total: data.total });
        }
        if (
          parts[5] === "runs" &&
          parts[6] === "latest-failed" &&
          method === "GET"
        ) {
          const run = await apiweave.runs.getLatestFailed(
            workspaceId,
            workflowId,
          );
          return ok({
            hasFailedRun: run !== null,
            runId: run?.runId,
            failedNodes: (run?.failedNodes ?? []).map((nodeId) => ({
              nodeId,
              label: nodeId,
              type: "unknown",
            })),
          });
        }
        if (parts[5] === "runs" && parts[6] && method === "GET") {
          const run = await apiweave.runs.get(workspaceId, segment(parts, 6));
          if (parts[7] === "nodes") {
            const nodeId = segment(parts, 8);
            return ok(
              run.results.find((result) => result.nodeId === nodeId) ?? null,
            );
          }
          return ok(run);
        }
      }

      if (parts[3] === "projects") {
        if (parts.length === 4 && method === "GET") {
          const data = await apiweave.projects.list(workspaceId);
          return ok({ projects: data.items, total: data.total });
        }
        if (parts.length === 4 && method === "POST") {
          const body = (payload ?? {}) as CollectionPatch &
            Pick<Project, "name">;
          return ok(
            await apiweave.projects.create({ workspaceId, ...body }),
          );
        }
        if (parts[4] === "import") {
          const bundle = (payload ?? {}) as ProjectBundle;
          return ok(
            parts[5] === "dry-run"
              ? await apiweave.projects.dryRun(workspaceId, bundle)
              : await apiweave.projects.import(workspaceId, bundle),
          );
        }
        const projectId = segment(parts, 4);
        if (parts.length === 5 && method === "GET")
          return ok(await apiweave.projects.get(workspaceId, projectId));
        if (parts.length === 5 && ["PUT", "PATCH"].includes(method)) {
          return ok(
            await apiweave.projects.update(
              workspaceId,
              projectId,
              (payload ?? {}) as CollectionPatch,
            ),
          );
        }
        if (parts.length === 5 && method === "DELETE") {
          await apiweave.projects.delete(workspaceId, projectId);
          return noContent();
        }
        if (parts[5] === "export" && method === "GET")
          return ok(await apiweave.projects.export(workspaceId, projectId));
        if (parts[5] === "workflows") {
          const workflowId = segment(parts, 6);
          if (parts[7] === "assign")
            return ok(
              await apiweave.projects.addWorkflow(
                workspaceId,
                projectId,
                workflowId,
              ),
            );
          if (method === "DELETE")
            return ok(
              await apiweave.projects.removeWorkflow(
                workspaceId,
                projectId,
                workflowId,
              ),
            );
        }
      }

      if (parts[3] === "environments") {
        if (parts.length === 4 && method === "GET") {
          const data = await apiweave.environments.list(workspaceId);
          return ok({ environments: data.items, total: data.total });
        }
        if (parts.length === 4 && method === "POST") {
          const body = (payload ?? {}) as EnvironmentPatch &
            Pick<Environment, "name">;
          return ok(
            await apiweave.environments.create({ workspaceId, ...body }),
          );
        }
        if (parts[4] === "all-accessible" && method === "GET") {
          const data = await apiweave.environments.list(workspaceId);
          return ok({ environments: data.items, total: data.total });
        }
        const environmentId = segment(parts, 4);
        if (parts.length === 5 && method === "GET") {
          return ok(await apiweave.environments.get(workspaceId, environmentId));
        }
        if (parts.length === 5 && ["PUT", "PATCH"].includes(method)) {
          return ok(
            await apiweave.environments.update(
              workspaceId,
              environmentId,
              (payload ?? {}) as EnvironmentPatch,
            ),
          );
        }
        if (parts.length === 5 && method === "DELETE") {
          await apiweave.environments.delete(workspaceId, environmentId);
          return noContent();
        }
      }
    }

    if (
      parts[0] === "api" &&
      parts[1] === "secrets" &&
      parts[2] === "public-key" &&
      method === "GET"
    ) {
      const scopeType = params.get("scope") as SecretScopeType | null;
      const scopeId = params.get("id");
      if ((scopeType !== "workspace" && scopeType !== "environment") || !scopeId) {
        return fail(new IpcError("validation", "missing secret scope"));
      }
      const workspaceId = scopeType === "workspace" ? scopeId : (params.get("workspaceId") ?? "default");
      return ok(await apiweave.secrets.publicKey(workspaceId, scopeType, scopeId));
    }

    if (parts[0] === "api" && parts[1] === "scopes" && parts[4] === "secrets") {
      const scopeType = segment(parts, 2) as SecretScopeType;
      const scopeId = segment(parts, 3);
      const workspaceId =
        scopeType === "workspace"
          ? scopeId
          : (params.get("workspaceId") ?? "default");
      if (method === "GET" && parts.length === 5) {
        const secrets = await apiweave.secrets.list(
          workspaceId,
          scopeType,
          scopeId,
        );
        return ok({ secrets, total: secrets.length });
      }
      if ((method === "POST" && parts.length === 5) || (["PUT", "PATCH"].includes(method) && parts[5])) {
        const body = (payload ?? {}) as {
          readonly name?: unknown;
          readonly ciphertext?: unknown;
          readonly keyId?: unknown;
          readonly label?: unknown;
        };
        if (typeof body.name !== "string" || typeof body.ciphertext !== "string" || typeof body.keyId !== "string") {
          return fail(new IpcError("validation", "missing secret payload"));
        }
        return ok(
          await apiweave.secrets.set({
            workspaceId,
            name: body.name,
            scopeType,
            scopeId,
            keyId: body.keyId,
            sealed: base64ToBytes(body.ciphertext),
            ...(typeof body.label === "string" ? { label: body.label } : {}),
          }),
        );
      }
      if (method === "DELETE" && parts[5]) {
        await apiweave.secrets.delete(
          workspaceId,
          scopeType,
          scopeId,
          segment(parts, 5),
        );
        return noContent();
      }
    }

    return fail(
      new IpcError("not_found", `No IPC route for ${method} ${path}`),
    );
  } catch (error) {
    return fail(error);
  }
}

export async function authenticatedJson<T = unknown>(
  input: string | URL | Request,
  options: AuthenticatedRequestInit = {},
): Promise<T> {
  const response = await authenticatedFetch(input, options);
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as {
      readonly detail?: string;
      readonly code?: ContractErrorCode;
    };
    throw new IpcError(
      body.code ?? "validation",
      body.detail
        ? `${response.status} ${body.detail}`
        : `IPC error ${response.status}`,
    );
  }
  return response.json() as Promise<T>;
}

export async function copyInviteLink(inviteUrl: string): Promise<boolean> {
  if (typeof navigator === "undefined" || !navigator.clipboard?.writeText)
    return false;
  try {
    await navigator.clipboard.writeText(inviteUrl);
    return true;
  } catch {
    return false;
  }
}

export function workflowsUrl(
  workspaceId: string,
  params?: {
    readonly skip?: number;
    readonly limit?: number;
    readonly includeAttached?: boolean;
  },
): string {
  const skip = params?.skip ?? 0;
  const limit = params?.limit ?? 20;
  const attached = params?.includeAttached ? "&include_attached=true" : "";
  return `${API_BASE_URL}/api/workspaces/${encodeURIComponent(workspaceId)}/workflows?skip=${skip}&limit=${limit}${attached}`;
}
export const workflowUrl = (workspaceId: string, workflowId: string): string =>
  `${API_BASE_URL}/api/workspaces/${encodeURIComponent(workspaceId)}/workflows/${encodeURIComponent(workflowId)}`;
export const personalWorkflowsUrl = (workspaceId: string): string =>
  workflowsUrl(workspaceId, { skip: 0, limit: 20 });
export const workflowsCreateInProjectUrl = (
  workspaceId: string,
  projectId: string,
): string =>
  `${workflowsUrl(workspaceId)}&project_id=${encodeURIComponent(projectId)}`;
export const workflowRunUrl = (
  workspaceId: string,
  workflowId: string,
  environmentId?: string | null,
): string =>
  `${workflowUrl(workspaceId, workflowId)}/run${environmentId ? `?environmentId=${encodeURIComponent(environmentId)}` : ""}`;
export const workflowRunsListUrl = (
  workspaceId: string,
  workflowId: string,
  page = 1,
  limit = 10,
): string =>
  `${workflowUrl(workspaceId, workflowId)}/runs?page=${page}&limit=${limit}`;
export const workflowLatestFailedUrl = (
  workspaceId: string,
  workflowId: string,
): string => `${workflowUrl(workspaceId, workflowId)}/runs/latest-failed`;
export const workflowRunStatusUrl = (
  workspaceId: string,
  workflowId: string,
  runId: string,
): string =>
  `${workflowUrl(workspaceId, workflowId)}/runs/${encodeURIComponent(runId)}`;
export const workflowNodeResultUrl = (
  workspaceId: string,
  workflowId: string,
  runId: string,
  nodeId: string,
): string =>
  `${workflowRunStatusUrl(workspaceId, workflowId, runId)}/nodes/${encodeURIComponent(nodeId)}/result`;
export const workflowDetailUrl = workflowUrl;
export const workflowImportUrl = (workspaceId: string): string =>
  `${API_BASE_URL}/api/workspaces/${encodeURIComponent(workspaceId)}/workflows/import`;
export const workflowImportDryRunUrl = (workspaceId: string): string =>
  `${workflowImportUrl(workspaceId)}/dry-run`;
export const workflowImportFormatUrl = (
  workspaceId: string,
  format: "har" | "openapi" | "curl",
  dryRun = false,
): string =>
  `${workflowImportUrl(workspaceId)}/${format}${dryRun ? "/dry-run" : ""}`;
export const workflowImportHarUrl = (
  workspaceId: string,
  dryRun = false,
): string => workflowImportFormatUrl(workspaceId, "har", dryRun);
export const workflowImportOpenapiUrl = (
  workspaceId: string,
  dryRun = false,
): string => workflowImportFormatUrl(workspaceId, "openapi", dryRun);
export const workflowImportOpenapiUrlUrl = (workspaceId: string): string =>
  `${workflowImportUrl(workspaceId)}/openapi/url`;
export const workflowImportCurlUrl = (
  workspaceId: string,
  dryRun = false,
): string => workflowImportFormatUrl(workspaceId, "curl", dryRun);
export function workflowImportOpenapiRemoteUrl(
  workspaceId: string,
  swaggerUrl: string,
  sanitize = true,
): string {
  const params = new URLSearchParams({
    swagger_url: swaggerUrl,
    sanitize: String(sanitize),
  });
  return `${workflowImportOpenapiUrlUrl(workspaceId)}?${params.toString()}`;
}
export const workflowExportUrl = (
  workspaceId: string,
  workflowId: string,
  includeEnvironment = true,
): string =>
  `${workflowUrl(workspaceId, workflowId)}/export?include_environment=${encodeURIComponent(String(includeEnvironment))}`;
export const workflowTemplatesUrl = (
  workspaceId: string,
  workflowId: string,
): string => `${workflowUrl(workspaceId, workflowId)}/templates`;
export const projectsUrl = (workspaceId: string, projectId?: string): string =>
  `${API_BASE_URL}/api/workspaces/${encodeURIComponent(workspaceId)}/projects${projectId ? `/${encodeURIComponent(projectId)}` : ""}`;
export const projectExportUrl = (
  workspaceId: string,
  projectId: string,
  includeEnvironment = true,
): string =>
  `${projectsUrl(workspaceId, projectId)}/export?include_environment=${encodeURIComponent(String(includeEnvironment))}`;
export const projectImportUrl = (workspaceId: string, dryRun = false): string =>
  `${projectsUrl(workspaceId)}/import${dryRun ? "/dry-run" : ""}`;
export const projectWorkflowAssignUrl = (
  workspaceId: string,
  projectId: string,
  workflowId: string,
): string =>
  `${projectsUrl(workspaceId, projectId)}/workflows/${encodeURIComponent(workflowId)}/assign`;
export const projectWorkflowRemoveUrl = (
  workspaceId: string,
  projectId: string,
  workflowId: string,
): string =>
  `${projectsUrl(workspaceId, projectId)}/workflows/${encodeURIComponent(workflowId)}`;
export function environmentsUrl(
  paramsOrWorkspaceId:
    | string
    | { readonly scopeType: string; readonly scopeId: string },
  scope: "workspace" | "all-accessible" = "workspace",
  orgId?: string | null,
): string {
  if (typeof paramsOrWorkspaceId !== "string") {
    if (paramsOrWorkspaceId.scopeType === "user")
      return `${API_BASE_URL}/api/users/${encodeURIComponent(paramsOrWorkspaceId.scopeId)}/environments`;
    if (paramsOrWorkspaceId.scopeType === "organization")
      return `${API_BASE_URL}/api/orgs/${encodeURIComponent(paramsOrWorkspaceId.scopeId)}/environments`;
    return `${API_BASE_URL}/api/workspaces/${encodeURIComponent(paramsOrWorkspaceId.scopeId)}/environments`;
  }
  const base = `${API_BASE_URL}/api/workspaces/${encodeURIComponent(paramsOrWorkspaceId)}/environments`;
  return scope === "all-accessible"
    ? `${base}/all-accessible${orgId ? `?org_id=${encodeURIComponent(orgId)}` : ""}`
    : base;
}
export const secretsUrl = (
  params: { readonly scopeType: string; readonly scopeId: string; readonly workspaceId?: string },
  secretId?: string,
): string =>
  `${API_BASE_URL}/api/scopes/${encodeURIComponent(params.scopeType)}/${encodeURIComponent(params.scopeId)}/secrets${secretId ? `/${encodeURIComponent(secretId)}` : ""}${params.workspaceId ? `?workspaceId=${encodeURIComponent(params.workspaceId)}` : ""}`;
export const publicKeyUrl = (scopeType: string, scopeId: string, workspaceId?: string): string =>
  `${API_BASE_URL}/api/secrets/public-key?scope=${encodeURIComponent(scopeType)}&id=${encodeURIComponent(scopeId)}${workspaceId ? `&workspaceId=${encodeURIComponent(workspaceId)}` : ""}`;
export const webhooksForWorkflowUrl = (resourceId: string): string =>
  `${API_BASE_URL}/api/webhooks/workflows/${encodeURIComponent(resourceId)}`;
export const webhooksForProjectUrl = (resourceId: string): string =>
  `${API_BASE_URL}/api/webhooks/collections/${encodeURIComponent(resourceId)}`;
export const webhooksCreateUrl = (): string => `${API_BASE_URL}/api/webhooks`;
export const webhookDetailUrl = (webhookId: string): string =>
  `${API_BASE_URL}/api/webhooks/${encodeURIComponent(webhookId)}`;
export const webhookRegenerateUrl = (webhookId: string): string =>
  `${webhookDetailUrl(webhookId)}/regenerate-token`;
export const webhookLogsUrl = (webhookId: string, limit = 50): string =>
  `${webhookDetailUrl(webhookId)}/logs?limit=${limit}`;

type DeletionTarget = {
  readonly workflowId?: string;
  readonly projectId?: string;
};
type DeletionResult = {
  readonly deleted: boolean;
  readonly workflowId?: string;
  readonly projectId?: string;
  readonly reason?: string;
};
type DeletionRequest = {
  readonly target?: DeletionTarget | null;
  readonly workspaceId?: string;
  readonly apiBaseUrl?: string;
  readonly fetchImpl?: unknown;
};
export async function requestWorkflowDeletion({
  target,
  workspaceId,
}: DeletionRequest): Promise<DeletionResult> {
  if (!target?.workflowId) return { deleted: false, reason: "missing-target" };
  if (!workspaceId) return { deleted: false, reason: "missing-workspace" };
  await apiweave.workflows.delete(workspaceId, target.workflowId);
  return { deleted: true, workflowId: target.workflowId };
}
export async function requestProjectDeletion({
  target,
  workspaceId,
}: DeletionRequest): Promise<DeletionResult> {
  if (!target?.projectId) return { deleted: false, reason: "missing-target" };
  if (!workspaceId) return { deleted: false, reason: "missing-workspace" };
  await apiweave.projects.delete(workspaceId, target.projectId);
  return { deleted: true, projectId: target.projectId };
}
