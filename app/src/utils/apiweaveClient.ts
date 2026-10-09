// fallow-ignore-file code-duplication -- `apiweave` is the renderer half of the IPC registry that `core/ipc/handlers/**` (already ignored for the same reason) is the main-process half of. Every namespace on it is the same three lines by construction — name the channel, name the method, forward the arguments to `invoke` — so any namespace gained clones every other one. There is no behaviour to share: the repetition *is* the typed surface.
import { createApiweaveClient } from "@shared/contract/client";
import type {
  ContractErrorCode,
  ContractResult,
} from "@shared/contract/errors";
import type { RunProgressEvent } from "@shared/types/RunProgressEvent";
import type { RunHistoryPage } from "@shared/types/RunHistoryPage";
import type { RunStartedEvent } from "@shared/types/RunStartedEvent";
import type { RunIteration } from "@shared/types/RunIteration";
import type { IterationRow } from "@shared/iteration-data/iterationData";
import type { ProjectRun } from "@shared/types/ProjectRun";
import type { PostmanImportPreview } from "@shared/types/PostmanImportPreview";
import type { PostmanImportResult } from "@shared/types/PostmanImportResult";
import type { ReportFormat } from "@shared/types/ReportFormat";
import type { AgentWriteEvent } from "@shared/types/AgentWriteEvent";
import type { AgentDefinition } from "@shared/types/AgentDefinition";
import type { AgentScope } from "@shared/types/AgentScope";
import type { AgentSession } from "@shared/types/AgentSession";
import type { AgentSessionEvent } from "@shared/types/AgentSessionEvent";
import type { AgentOutputEvent } from "@shared/types/AgentOutputEvent";
import type { WorkflowChangedEvent } from "@shared/types/WorkflowChangedEvent";
import { AGENT_OUTPUT_PORT_MESSAGE_KEY } from "@shared/types/AgentOutputEvent";
import type {
  AgentEmbeddedLaunchRequest,
  AgentLaunchRequest,
  AgentPathResolution,
  AgentRosterEntry,
  AgentsBridge,
} from "@shared/types/AgentsBridge";
import type { McpStatus } from "@shared/types/McpStatus";
import type { OAuthBridge } from "@shared/types/OAuthBridge";
import type { OAuthTokenRequest } from "@shared/types/OAuthTokenRequest";
import type { OAuthTokenStatus } from "@shared/types/OAuthTokenStatus";
import type { NetworkBridge } from "@shared/types/NetworkBridge";
import type { NetworkSettingsState } from "@shared/types/NetworkSettingsState";
import type { NetworkSettingsUpdate } from "@shared/types/NetworkSettingsUpdate";
import type { MCPTool } from "@shared/types/MCPTool";
import type { MCPPrompt } from "@shared/types/MCPPrompt";
import type { MCPResource } from "@shared/types/MCPResource";
import type { McpTestResult } from "@shared/types/McpTestResult";
import type {
  UpdatePolicy,
  UpdatesBridge,
  UpdateStatus,
} from "@shared/types/UpdateStatus";
import { DEFAULT_UPDATE_POLICY } from "@shared/types/UpdateStatus";
import type { AssertionApplyResult } from "@shared/types/AssertionApplyResult";
import type { AssertionItem } from "@shared/types/AssertionItem";
import type { AssertionSuggestionResult } from "@shared/types/AssertionSuggestionResult";
import type { AssertionValidationResult } from "@shared/types/AssertionValidationResult";
import type { NodePreset } from "../types/NodePreset";
import type { NodePresetNodeType } from "../types/NodePresetNodeType";
import type { Project } from "../types/Project";
import type { DryRunResult } from "../types/DryRunResult";
import type { ProjectImportDryRunResult } from "../types/ProjectImportDryRunResult";
import type { ImportResult } from "../types/ImportResult";
import type { Run } from "../types/Run";
import type { ScopedEnvironment } from "../types/ScopedEnvironment";
import type { Workflow } from "../types/Workflow";
import type { Workspace } from "../types/Workspace";
import type {
  CloudBindWorkspaceInput,
  CloudCreateTeamWorkspaceInput,
  CloudFailedRecord,
  CloudSyncStatus,
  CloudUnlinkOptions,
} from "../types/cloud";

type Environment = ScopedEnvironment;
type JsonValue = unknown;
type IpcRun = Run & {
  readonly workspaceId?: string;
  readonly selectedEnvironmentId?: string | null;
  readonly failedNodes?: readonly string[] | null;
  readonly nodeStatuses?: Record<string, JsonValue>;
  readonly variables?: Record<string, JsonValue>;
  readonly iteration?: RunIteration | null;
  readonly resolvedSecrets?: readonly {
    readonly name: string;
    readonly scopeType: "environment" | "workspace" | null;
    readonly resolved: boolean;
  }[];
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
  readonly onRunStarted?: (
    callback: (event: RunStartedEvent) => void,
  ) => () => void;
  readonly onProjectRunChanged?: (
    callback: (projectRun: ProjectRun) => void,
  ) => () => void;
  readonly onAgentWrite?: (
    callback: (event: AgentWriteEvent) => void,
  ) => () => void;
  readonly onCloudStatusChanged?: (callback: () => void) => () => void;
  readonly onWorkflowChanged?: (
    callback: (event: WorkflowChangedEvent) => void,
  ) => () => void;
};

type DesktopBridge = {
  readonly minimize: () => void;
  readonly toggleMaximize: () => void;
  readonly close: () => void;
  readonly onMaximizeChange: (
    callback: (isMaximized: boolean) => void,
  ) => () => void;
  readonly onCloseRequested: (handler: () => Promise<boolean>) => () => void;
  readonly screenReader?: boolean;
};

type McpBridge = {
  readonly getStatus: () => Promise<McpStatus>;
  readonly enable: () => Promise<McpStatus>;
  readonly disable: () => Promise<McpStatus>;
  readonly regenerateToken: () => Promise<McpStatus>;
  readonly listTools: () => Promise<readonly MCPTool[]>;
  readonly listPrompts: () => Promise<readonly MCPPrompt[]>;
  readonly listResources: () => Promise<readonly MCPResource[]>;
  readonly testConnection: () => Promise<McpTestResult>;
};

declare global {
  interface Window {
    __APIWEAVE_IPC__?: IpcBridge;
    __APIWEAVE_DESKTOP__?: DesktopBridge;
    __APIWEAVE_MCP__?: McpBridge;
    __APIWEAVE_UPDATES__?: UpdatesBridge;
    __APIWEAVE_AGENTS__?: AgentsBridge;
    __APIWEAVE_OAUTH__?: OAuthBridge;
    __APIWEAVE_NETWORK__?: NetworkBridge;
    apiweave?: typeof apiweave;
  }

  interface ImportMeta {
    readonly env: {
      readonly VITE_APP_VERSION?: string;
    };
  }
}

type GlobalWithApiweave = typeof globalThis & {
  __APIWEAVE_IPC__?: IpcBridge;
  __APIWEAVE_DESKTOP__?: DesktopBridge;
  __APIWEAVE_MCP__?: McpBridge;
  __APIWEAVE_UPDATES__?: UpdatesBridge;
  __APIWEAVE_AGENTS__?: AgentsBridge;
  __APIWEAVE_OAUTH__?: OAuthBridge;
  __APIWEAVE_NETWORK__?: NetworkBridge;
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
    | "workspaceId"
    | "environmentId"
    | "rev"
    | "createdAt"
    | "updatedAt"
    | "description"
    | "swaggerDocUrl"
  >
> & {
  /** null clears the field. */
  readonly description?: string | null;
  readonly swaggerDocUrl?: string | null;
};
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
  readonly createdAt: string;
  readonly updatedAt: string;
};
type ResolvedSecret = {
  readonly metadata: SecretMetadata;
  readonly resolvedScope: SecretScopeType;
};
type SecretScopeTarget = {
  readonly workspaceId: string;
  readonly scopeType: SecretScopeType;
  readonly scopeId: string;
  readonly name?: string;
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
    /** `expectedRevision` makes the save fail with `conflict` if someone else's edit landed first. */
    update: (
      workspaceId: string,
      workflowId: string,
      patch: WorkflowPatch & { readonly expectedRevision?: number },
    ) =>
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
    /**
     * Move a workflow to another workspace. `targetCollectionId` names a project
     * in the TARGET workspace (or null for unassigned); the selected environment
     * and any Call Workflow targets left behind are cleared server-side, so show
     * the user what they lose before calling this.
     */
    moveToWorkspace: (
      workspaceId: string,
      workflowId: string,
      targetWorkspaceId: string,
      targetCollectionId: string | null,
    ) =>
      invoke<Workflow>("workflows", "moveToWorkspace", {
        workspaceId,
        workflowId,
        targetWorkspaceId,
        targetCollectionId,
      }),
    import: (input: {
      readonly workspaceId: string;
      readonly bundle: unknown;
      readonly createMissingEnvironments?: boolean;
      readonly sanitize?: boolean;
      readonly collectionId?: string;
    }) => invoke<ImportResult>("workflows", "import", input),
    dryRun: (workspaceId: string, bundle: unknown) =>
      invoke<DryRunResult>("workflows", "dryRun", { workspaceId, bundle }),
    /** An `.aweflow` bundle; secrets travel as references only. */
    export: (
      workspaceId: string,
      workflowId: string,
      includeEnvironment = true,
    ) =>
      invoke<unknown>("workflows", "export", {
        workspaceId,
        workflowId,
        includeEnvironment,
      }),
    // The parsers below answer a preview with `dryRun`, and parsed nodes
    // otherwise; both shapes belong to the importer UI that asked.
    importOpenapi: (input: {
      readonly workspaceId: string;
      readonly spec: string;
      readonly baseUrl?: string;
      readonly tagFilter?: readonly string[];
      readonly sanitize?: boolean;
      readonly schemaAssertions?: boolean;
      readonly dryRun?: boolean;
    }) => invoke<unknown>("workflows", "importOpenapi", input),
    importOpenapiUrl: (input: {
      readonly workspaceId: string;
      readonly url: string;
      readonly baseUrl?: string;
      readonly tagFilter?: readonly string[];
      readonly sanitize?: boolean;
      readonly dryRun?: boolean;
    }) => invoke<unknown>("workflows", "importOpenapiUrl", input),
    importHar: (input: {
      readonly workspaceId: string;
      readonly data: Record<string, unknown>;
      readonly importMode?: "linear" | "grouped";
      readonly sanitize?: boolean;
      readonly dryRun?: boolean;
    }) => invoke<unknown>("workflows", "importHar", input),
    importCurl: (input: {
      readonly workspaceId: string;
      readonly curlCommand: string;
      readonly sanitize?: boolean;
      readonly dryRun?: boolean;
      readonly parseOnly?: boolean;
      readonly workflowId?: string;
      readonly collectionId?: string;
    }) => invoke<unknown>("workflows", "importCurl", input),
    saveTemplates: (
      workspaceId: string,
      workflowId: string,
      templates: readonly unknown[],
    ) =>
      invoke<Workflow>("workflows", "saveTemplates", {
        workspaceId,
        workflowId,
        templates,
      }),
  },
  assertions: {
    suggest: (
      workspaceId: string,
      workflowId: string,
      runId: string,
      sourceNodeId: string,
    ) => invoke<AssertionSuggestionResult>("assertions", "suggest", {
      workspaceId,
      workflowId,
      runId,
      sourceNodeId,
    }),
    validate: (
      workspaceId: string,
      workflowId: string,
      sourceNodeId: string,
      rules: readonly AssertionItem[],
      runId?: string,
    ) => invoke<AssertionValidationResult>("assertions", "validate", {
      workspaceId,
      workflowId,
      sourceNodeId,
      rules,
      ...(runId !== undefined ? { runId } : {}),
    }),
    apply: (
      workspaceId: string,
      workflowId: string,
      expectedRevision: number,
      assertionNodeId: string,
      mode: "append" | "replace",
      rules: readonly AssertionItem[],
    ) => invoke<AssertionApplyResult>("assertions", "apply", {
      workspaceId,
      workflowId,
      expectedRevision,
      assertionNodeId,
      mode,
      rules,
    }),
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
    duplicate: (
      workspaceId: string,
      environmentId: string,
      targetWorkspaceId?: string,
      name?: string,
    ) =>
      invoke<Environment>("environments", "duplicate", {
        workspaceId,
        environmentId,
        ...(targetWorkspaceId ? { targetWorkspaceId } : {}),
        ...(name ? { name } : {}),
      }),
    moveToWorkspace: (
      workspaceId: string,
      environmentId: string,
      targetWorkspaceId: string,
    ) =>
      invoke<Environment>("environments", "moveToWorkspace", {
        workspaceId,
        environmentId,
        targetWorkspaceId,
      }),
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
  nodePresets: {
    create: (input: {
      readonly workspaceId: string;
      readonly name: string;
      readonly nodeType: NodePresetNodeType;
      readonly config?: Record<string, unknown>;
    }) => invoke<NodePreset>("nodePresets", "create", input),
    list: (workspaceId: string) =>
      invoke<ListResult<NodePreset>>("nodePresets", "list", { workspaceId }),
    update: (
      workspaceId: string,
      presetId: string,
      patch: {
        readonly name?: string;
        readonly nodeType?: NodePresetNodeType;
        readonly config?: Record<string, unknown>;
      },
    ) =>
      invoke<NodePreset>("nodePresets", "update", {
        workspaceId,
        presetId,
        ...patch,
      }),
    delete: (workspaceId: string, presetId: string) =>
      invoke<null>("nodePresets", "delete", { workspaceId, presetId }),
  },
  runs: {
    create: (
      input: {
        readonly workspaceId: string;
        readonly workflowId: string;
        readonly waitMs?: number;
        readonly operationId?: string;
      } & Partial<IpcRun>,
    ) => invoke<IpcRun>("runs", "create", input),
    /** A data-driven run: the workflow once per row. Returns iteration 1's run. */
    createIterations: (input: {
      readonly workspaceId: string;
      readonly workflowId: string;
      readonly selectedEnvironmentId?: string | null;
      readonly rows: readonly IterationRow[];
    }) => invoke<IpcRun>("runs", "createIterations", input),
    wait: (workspaceId: string, runId: string, waitMs?: number) =>
      invoke<IpcRun>("runs", "wait", waitMs === undefined ? { workspaceId, runId } : { workspaceId, runId, waitMs }),
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
    history: (input: {
      readonly workspaceId: string;
      readonly workflowId?: string;
      readonly limit?: number;
      readonly cursor?: string;
    }) => invoke<RunHistoryPage>("runs", "history", input),
    delete: (workspaceId: string, runId: string) =>
      invoke<null>("runs", "delete", { workspaceId, runId }),
    clearHistory: (workspaceId: string, workflowId: string) =>
      invoke<{ deleted: number }>("runs", "clearHistory", { workspaceId, workflowId }),
    report: (workspaceId: string, runId: string, format: ReportFormat) =>
      invoke<string>("runs", "report", { workspaceId, runId, format }),
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
    duplicate: (
      workspaceId: string,
      scopeType: SecretScopeType,
      scopeId: string,
      name: string,
      target: SecretScopeTarget,
    ) =>
      invoke<SecretMetadata>("secrets", "duplicate", {
        workspaceId,
        scopeType,
        scopeId,
        name,
        target,
      }),
    moveToScope: (
      workspaceId: string,
      scopeType: SecretScopeType,
      scopeId: string,
      name: string,
      target: SecretScopeTarget,
    ) =>
      invoke<SecretMetadata>("secrets", "moveToScope", {
        workspaceId,
        scopeType,
        scopeId,
        name,
        target,
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
    /** Move a project and every workflow in it to another workspace. */
    moveToWorkspace: (
      workspaceId: string,
      collectionId: string,
      targetWorkspaceId: string,
    ) =>
      invoke<Project>("projects", "moveToWorkspace", {
        workspaceId,
        collectionId,
        targetWorkspaceId,
      }),
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
    /** Run the project's enabled workflows in order against one environment (null for none). */
    run: (workspaceId: string, projectId: string, environmentId: string | null) =>
      invoke<ProjectRun>("projects", "run", {
        workspaceId,
        projectId,
        environmentId,
      }),
    getRun: (workspaceId: string, projectRunId: string) =>
      invoke<ProjectRun>("projects", "getRun", { workspaceId, projectRunId }),
    listRuns: (workspaceId: string, projectId: string) =>
      invoke<ListResult<ProjectRun>>("projects", "listRuns", {
        workspaceId,
        projectId,
      }),
    runReport: (
      workspaceId: string,
      projectRunId: string,
      format: ReportFormat,
    ) =>
      invoke<string>("projects", "runReport", {
        workspaceId,
        projectRunId,
        format,
      }),
    cancelRun: (workspaceId: string, projectRunId: string) =>
      invoke<ProjectRun>("projects", "cancelRun", {
        workspaceId,
        projectRunId,
      }),
    export: (
      workspaceId: string,
      projectId: string,
      includeEnvironments = true,
    ) =>
      invoke<ProjectBundle>("projects", "export", {
        workspaceId,
        projectId,
        includeEnvironments,
      }),
    import: (
      workspaceId: string,
      bundle: ProjectBundle,
      options: { readonly targetProjectId?: string; readonly projectName?: string } = {},
    ) =>
      invoke<unknown>("projects", "import", { workspaceId, bundle, ...options }),
    dryRun: (workspaceId: string, bundle: ProjectBundle) =>
      invoke<ProjectImportDryRunResult>("projects", "dryRun", {
        workspaceId,
        bundle,
      }),
    // A Postman Collection v2.1 (and optional Postman environment), as parsed JSON.
    previewPostman: (input: {
      readonly workspaceId: string;
      readonly collection: Record<string, unknown>;
      readonly environment?: Record<string, unknown>;
      readonly mode?: "folder" | "request";
      readonly projectName?: string;
    }) => invoke<PostmanImportPreview>("projects", "previewPostman", input),
    importPostman: (input: {
      readonly workspaceId: string;
      readonly collection: Record<string, unknown>;
      readonly environment?: Record<string, unknown>;
      readonly mode?: "folder" | "request";
      readonly projectName?: string;
    }) => invoke<PostmanImportResult>("projects", "importPostman", input),
  },
  cloud: {
    status: () => invoke<CloudSyncStatus>("cloud", "status", {}),
    link: (deviceLabel?: string) =>
      invoke<CloudSyncStatus>("cloud", "link", deviceLabel ? { deviceLabel } : {}),
    cancelLink: () => invoke<CloudSyncStatus>("cloud", "cancelLink", {}),
    unlink: (options: CloudUnlinkOptions = {}) =>
      invoke<CloudSyncStatus>("cloud", "unlink", {
        ...(options.localOnly === true ? { localOnly: true } : {}),
        ...(options.purgeLocalData === true ? { purgeLocalData: true } : {}),
      }),
    bindWorkspace: (input: CloudBindWorkspaceInput) =>
      invoke<CloudSyncStatus>("cloud", "bindWorkspace", input),
    createTeamWorkspace: (input: CloudCreateTeamWorkspaceInput) =>
      invoke<Workspace>("cloud", "createTeamWorkspace", input),
    // Encryption. Passphrases are write-only: they go straight to main, which
    // stretches them into a KEK and drops them. Nothing here retains one.
    setWorkspaceEncryption: (workspaceId: string, passphrase: string) =>
      invoke<CloudSyncStatus>("cloud", "setWorkspaceEncryption", {
        workspaceId,
        passphrase,
      }),
    declineWorkspaceEncryption: (workspaceId: string) =>
      invoke<CloudSyncStatus>("cloud", "declineWorkspaceEncryption", {
        workspaceId,
      }),
    unlockWorkspace: (workspaceId: string, passphrase: string) =>
      invoke<CloudSyncStatus>("cloud", "unlockWorkspace", {
        workspaceId,
        passphrase,
      }),
    lockWorkspace: (workspaceId: string) =>
      invoke<CloudSyncStatus>("cloud", "lockWorkspace", { workspaceId }),
    unbindWorkspace: (workspaceId: string) =>
      invoke<CloudSyncStatus>("cloud", "unbindWorkspace", { workspaceId }),
    initializeWorkspace: (workspaceId: string) =>
      invoke<CloudSyncStatus>("cloud", "initializeWorkspace", { workspaceId }),
    refreshWorkspaceCatalog: () =>
      invoke<CloudSyncStatus>("cloud", "refreshWorkspaceCatalog", {}),
    retryDeadLetters: (workspaceId: string) =>
      invoke<CloudSyncStatus>("cloud", "retryDeadLetters", { workspaceId }),
    discardDeadLetters: (workspaceId: string) =>
      invoke<CloudSyncStatus>("cloud", "discardDeadLetters", { workspaceId }),
    listFailedRecords: (workspaceId: string) =>
      invoke<readonly CloudFailedRecord[]>("cloud", "listFailedRecords", {
        workspaceId,
      }),
    pull: () => invoke<CloudSyncStatus>("cloud", "pull", {}),
    push: () => invoke<CloudSyncStatus>("cloud", "push", {}),
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

/**
 * Subscribe to every run that starts, whoever started it — including a run an
 * agent triggered over MCP, which no renderer call returned a runId for. Unkeyed
 * by design; see `RUN_STARTED_CHANNEL`.
 */
export function onRunStarted(
  callback: (event: RunStartedEvent) => void,
): () => void {
  return getIpcBridge().onRunStarted?.(callback) ?? (() => undefined);
}

/**
 * Subscribe to every change to any project run, whoever started it. Each event
 * carries the whole record; see `PROJECT_RUN_CHANGED_CHANNEL`.
 */
export function onProjectRunChanged(
  callback: (projectRun: ProjectRun) => void,
): () => void {
  return getIpcBridge().onProjectRunChanged?.(callback) ?? (() => undefined);
}

/**
 * Subscribe to every write an agent makes over MCP. Coarse — the domain and
 * action only; see `AGENT_WRITE_CHANNEL` for why the renderer needs it and why
 * it refetches rather than patches.
 */
export function onAgentWrite(
  callback: (event: AgentWriteEvent) => void,
): () => void {
  return getIpcBridge().onAgentWrite?.(callback) ?? (() => undefined);
}

/** Subscribe to the token-free main→renderer cloud-status-changed signal. The
 * renderer refetches authoritative status on each tick. No-op (returns an inert
 * unsubscribe) when the bridge or signal is absent, e.g. web preview. */
export function onCloudStatusChanged(callback: () => void): () => void {
  return getIpcBridge().onCloudStatusChanged?.(callback) ?? (() => undefined);
}

/** Subscribe to authoritative workflow writes made by another process or tab. */
export function onWorkflowChanged(callback: (event: WorkflowChangedEvent) => void): () => void {
  return getIpcBridge().onWorkflowChanged?.(callback) ?? (() => undefined);
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
  /** Main's quit handshake: the handler resolves whether the window may close. */
  onCloseRequested: (handler: () => Promise<boolean>) =>
    getDesktopBridge()?.onCloseRequested(handler) ?? (() => undefined),
  /**
   * Whether the OS reports a screen reader, as main saw it at window creation.
   * False outside Electron, which is also the right answer for the web preview:
   * nothing there renders the terminal this gates.
   */
  hasScreenReader: (): boolean => getDesktopBridge()?.screenReader === true,
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
  regenerateToken: (): Promise<McpStatus> =>
    getMcpBridge()?.regenerateToken() ??
    Promise.resolve({ running: false, config: null }),
  listTools: (): Promise<readonly MCPTool[]> =>
    getMcpBridge()?.listTools() ?? Promise.resolve([]),
  listPrompts: (): Promise<readonly MCPPrompt[]> =>
    getMcpBridge()?.listPrompts() ?? Promise.resolve([]),
  listResources: (): Promise<readonly MCPResource[]> =>
    getMcpBridge()?.listResources() ?? Promise.resolve([]),
  testConnection: (): Promise<McpTestResult> =>
    getMcpBridge()?.testConnection() ??
    Promise.resolve({ ok: false, status: null }),
} as const;

function getUpdatesBridge(): UpdatesBridge | undefined {
  return (
    globalThis.window?.__APIWEAVE_UPDATES__ ??
    globalApiweave.__APIWEAVE_UPDATES__
  );
}

const idleUpdateStatus: UpdateStatus = {
  state: "idle",
  currentVersion: "0.0.0",
  latestVersion: null,
  releaseUrl: null,
  downloadProgressPercent: null,
  supportsAutoInstall: false,
  policy: DEFAULT_UPDATE_POLICY,
  lastCheckedAt: null,
  error: null,
};

/** Controls for the Settings > Updates panel. Resolves to an idle status
 * when the bridge is absent (e.g. web preview outside Electron). The
 * per-method `?.` on the newer calls keeps a renderer paired with an older
 * preload from throwing rather than degrading. */
export const updates = {
  isAvailable: (): boolean => getUpdatesBridge() !== undefined,
  getStatus: (): Promise<UpdateStatus> =>
    getUpdatesBridge()?.getStatus() ?? Promise.resolve(idleUpdateStatus),
  check: (): Promise<UpdateStatus> =>
    getUpdatesBridge()?.check() ?? Promise.resolve(idleUpdateStatus),
  download: (): Promise<UpdateStatus> =>
    getUpdatesBridge()?.download?.() ?? Promise.resolve(idleUpdateStatus),
  setPolicy: (policy: UpdatePolicy): Promise<UpdateStatus> =>
    getUpdatesBridge()?.setPolicy?.(policy) ?? Promise.resolve(idleUpdateStatus),
  restartAndInstall: (): Promise<void> =>
    getUpdatesBridge()?.restartAndInstall() ?? Promise.resolve(),
  openReleasePage: (): Promise<void> =>
    getUpdatesBridge()?.openReleasePage() ?? Promise.resolve(),
  openLogFile: (): Promise<void> =>
    getUpdatesBridge()?.openLogFile?.() ?? Promise.resolve(),
  onStatusChanged: (callback: (status: UpdateStatus) => void): (() => void) =>
    getUpdatesBridge()?.onStatusChanged(callback) ?? (() => undefined),
} as const;

function getAgentsBridge(): AgentsBridge | undefined {
  return (
    globalThis.window?.__APIWEAVE_AGENTS__ ?? globalApiweave.__APIWEAVE_AGENTS__
  );
}

/**
 * Coding-agent roster, project paths and launching.
 *
 * Deliberately a sibling of `mcp` and `updates` rather than a domain on the
 * router facade: the router doubles as the MCP bridge's handler surface, and
 * process spawning does not belong there. See `AgentsBridge`.
 *
 * Every method degrades rather than throws when the bridge is absent, which is
 * the web preview outside Electron — there is no PATH to probe and nothing to
 * launch there, so an empty roster is the honest answer.
 */
export const agents = {
  isAvailable: (): boolean => getAgentsBridge() !== undefined,
  listRoster: (workspaceId: string): Promise<readonly AgentRosterEntry[]> =>
    getAgentsBridge()?.listRoster(workspaceId) ?? Promise.resolve([]),
  refreshAvailability: (
    workspaceId: string,
  ): Promise<readonly AgentRosterEntry[]> =>
    getAgentsBridge()?.refreshAvailability(workspaceId) ?? Promise.resolve([]),
  saveCustomAgent: (
    workspaceId: string,
    definition: AgentDefinition,
  ): Promise<AgentRosterEntry> =>
    getAgentsBridge()?.saveCustomAgent(workspaceId, definition) ??
    Promise.reject(new Error("Agents are only available in the desktop app")),
  deleteCustomAgent: (workspaceId: string, agentKey: string): Promise<void> =>
    getAgentsBridge()?.deleteCustomAgent(workspaceId, agentKey) ??
    Promise.resolve(),
  getDefaultAgentKey: (workspaceId: string): Promise<string> =>
    getAgentsBridge()?.getDefaultAgentKey(workspaceId) ?? Promise.resolve(""),
  setDefaultAgentKey: (workspaceId: string, agentKey: string): Promise<void> =>
    getAgentsBridge()?.setDefaultAgentKey(workspaceId, agentKey) ??
    Promise.resolve(),
  resolveLocalPath: (
    workspaceId: string,
    scope: AgentScope,
  ): Promise<AgentPathResolution> =>
    getAgentsBridge()?.resolveLocalPath(workspaceId, scope) ??
    Promise.resolve({ localPath: null, source: "none" as const }),
  chooseLocalPath: (
    workspaceId: string,
    scope: AgentScope,
  ): Promise<string | null> =>
    getAgentsBridge()?.chooseLocalPath(workspaceId, scope) ??
    Promise.resolve(null),
  clearLocalPath: (workspaceId: string, scope: AgentScope): Promise<void> =>
    getAgentsBridge()?.clearLocalPath(workspaceId, scope) ?? Promise.resolve(),
  listSessions: (workspaceId: string): Promise<readonly AgentSession[]> =>
    getAgentsBridge()?.listSessions(workspaceId) ?? Promise.resolve([]),
  launchExternal: (request: AgentLaunchRequest): Promise<AgentSession> =>
    getAgentsBridge()?.launchExternal(request) ??
    Promise.reject(new Error("Agents are only available in the desktop app")),
  launchEmbedded: (request: AgentEmbeddedLaunchRequest): Promise<AgentSession> =>
    getAgentsBridge()?.launchEmbedded(request) ??
    Promise.reject(new Error("Agents are only available in the desktop app")),
  /**
   * Reopen a finished session's conversation. Rejects rather than resolving
   * without a bridge, as the launches do: there is a button behind this, and it
   * has to be able to say why nothing happened.
   */
  resumeSession: (
    sessionId: string,
    cols: number,
    rows: number,
  ): Promise<AgentSession> =>
    getAgentsBridge()?.resumeSession(sessionId, cols, rows) ??
    Promise.reject(new Error("Agents are only available in the desktop app")),
  write: (sessionId: string, data: string): Promise<void> =>
    getAgentsBridge()?.write(sessionId, data) ?? Promise.resolve(),
  resize: (sessionId: string, cols: number, rows: number): Promise<void> =>
    getAgentsBridge()?.resize(sessionId, cols, rows) ?? Promise.resolve(),
  setPaused: (sessionId: string, paused: boolean): Promise<void> =>
    getAgentsBridge()?.setPaused(sessionId, paused) ?? Promise.resolve(),
  killSession: (sessionId: string): Promise<AgentSession> =>
    getAgentsBridge()?.killSession(sessionId) ??
    Promise.reject(new Error("Agents are only available in the desktop app")),
  /**
   * Forget a finished session's record. Resolves rather than rejects without a
   * bridge, matching `deleteCustomAgent`: outside the desktop shell there is no
   * session table, so there is nothing left to remove and nothing to report.
   */
  deleteSession: (sessionId: string): Promise<void> =>
    getAgentsBridge()?.deleteSession(sessionId) ?? Promise.resolve(),
  onSessionChanged: (
    callback: (event: AgentSessionEvent) => void,
  ): (() => void) =>
    getAgentsBridge()?.onSessionChanged(callback) ?? (() => undefined),
  /**
   * Attach to one session's live output.
   *
   * The listener goes on before the request, not after: the port is delivered by
   * a `window.postMessage` that main triggers while `attach` is still in flight,
   * so registering afterwards is a race this would lose about as often as it won.
   *
   * Resolves the unsubscribe when a live process was attached to, and `null`
   * when there was none — an ended session, or one from a previous run of the
   * app. The caller shows that as history rather than as a dead terminal.
   */
  attachOutput: async (
    sessionId: string,
    onEvent: (event: AgentOutputEvent) => void,
  ): Promise<(() => void) | null> => {
    const bridge = getAgentsBridge();
    if (bridge === undefined) return null;

    let port: MessagePort | null = null;
    const onWindowMessage = (event: MessageEvent<unknown>): void => {
      const data = event.data;
      if (typeof data !== "object" || data === null) return;
      const announced = (data as Record<string, unknown>)[
        AGENT_OUTPUT_PORT_MESSAGE_KEY
      ];
      const delivered = event.ports[0];
      if (announced !== sessionId || delivered === undefined) return;
      port = delivered;
      delivered.onmessage = (message: MessageEvent<AgentOutputEvent>) => {
        onEvent(message.data);
      };
      // `onmessage` starts the port implicitly; `start()` here would be a
      // second, redundant claim.
    };
    window.addEventListener("message", onWindowMessage);

    const teardown = (): void => {
      window.removeEventListener("message", onWindowMessage);
      port?.close();
      port = null;
    };

    try {
      const attached = await bridge.attach(sessionId);
      if (!attached) {
        teardown();
        return null;
      }
      return teardown;
    } catch (error) {
      teardown();
      throw error;
    }
  },
} as const;

function getOAuthBridge(): OAuthBridge | undefined {
  return (
    globalThis.window?.__APIWEAVE_OAUTH__ ?? globalApiweave.__APIWEAVE_OAUTH__
  );
}

const oauthDesktopOnly = (): Promise<never> =>
  Promise.reject(new Error("OAuth sign-in is only available in the desktop app"));

/**
 * OAuth 2.0 sign-in for HTTP nodes (Get token, its status, Clear token). A
 * sibling of `agents`, off the router facade: see `OAuthBridge`.
 */
export const oauth = {
  authorize: (request: OAuthTokenRequest): Promise<OAuthTokenStatus> =>
    getOAuthBridge()?.authorize(request) ?? oauthDesktopOnly(),
  status: (request: OAuthTokenRequest): Promise<OAuthTokenStatus> =>
    getOAuthBridge()?.status(request) ?? oauthDesktopOnly(),
  clear: (request: OAuthTokenRequest): Promise<OAuthTokenStatus> =>
    getOAuthBridge()?.clear(request) ?? oauthDesktopOnly(),
} as const;

function getNetworkBridge(): NetworkBridge | undefined {
  return (
    globalThis.window?.__APIWEAVE_NETWORK__ ??
    globalApiweave.__APIWEAVE_NETWORK__
  );
}

const networkDesktopOnly = (): Promise<never> =>
  Promise.reject(
    new Error("Network settings are only available in the desktop app"),
  );

/** Electron wraps an error thrown in main as "Error invoking remote method 'x': Error: <message>". */
function unwrapRemoteError(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error);
  throw new Error(
    message.replace(/^Error invoking remote method '[^']*': (?:\w*Error: )?/, ""),
  );
}

/** Settings > Network. A sibling of `oauth`, off the router facade: see `NetworkBridge`. */
export const network = {
  get: (): Promise<NetworkSettingsState> =>
    getNetworkBridge()?.get() ?? networkDesktopOnly(),
  save: (update: NetworkSettingsUpdate): Promise<NetworkSettingsState> =>
    getNetworkBridge()?.save(update).catch(unwrapRemoteError) ??
    networkDesktopOnly(),
  chooseFile: (): Promise<string | null> =>
    getNetworkBridge()?.chooseFile() ?? networkDesktopOnly(),
} as const;
