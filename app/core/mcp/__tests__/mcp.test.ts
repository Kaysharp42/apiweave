import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { rmSync, readFileSync } from "node:fs"
import http from "node:http"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { ResourceUpdatedNotificationSchema } from "@modelcontextprotocol/sdk/types.js"
import { RunEventBroker } from "../../runner/run_event_broker"
import { initDatabase, type InitializedDatabase } from "../../db"
import {
  CollectionRepository,
  EnvironmentRepository,
  RunRepository,
  WorkflowRepository,
  WorkspaceRepository,
} from "../../repositories"
import { LocalOwnerProvider } from "../../auth/LocalOwnerProvider"
import { LocalOnlySyncProvider } from "../../sync/LocalOnlySyncProvider"
import { ScopeResolver, type ScopeExistence } from "../../services/scope_resolver"
import { WorkspaceService } from "../../services/workspace_service"
import { CollectionService } from "../../services/collection_service"
import { WorkflowService } from "../../services/workflow_service"
import { WorkflowAnalysisService } from "../../services/workflow_analysis_service"
import { AssertionAuthoringService } from "../../services/assertion_authoring_service"
import { EnvironmentService } from "../../services/environment_service"
import { RunService } from "../../services/run_service"
import { SecretService, type SecretWriteStore, type SecretUpsert } from "../../services/secret_service"
import { ProjectExportService } from "../../services/project_export_service"
import type { SecretMetadata, SecretScopeType } from "../../secrets/scoped_secret_resolver"
import { IpcRouter } from "../../ipc/router"
import { registerAllHandlers, type HandlerDeps } from "../../ipc/handlers"
import { MCP_TOOLS, toolName } from "../tools"
import { MCP_PROMPTS, AUTHOR_ASSERTIONS_PROMPT } from "../prompts"
import { createMcpServer } from "../server"
import { McpHost } from "../host"

/** In-memory write-only secret store (mirrors handlers.test.ts). */
class FakeSecretStore implements SecretWriteStore {
  private readonly rows = new Map<string, { meta: SecretMetadata; sealed: Uint8Array }>()
  private key(t: string, s: string, n: string): string {
    return `${t}/${s}/${n}`
  }
  put(input: SecretUpsert): SecretMetadata {
    const meta: SecretMetadata = {
      secretId: this.key(input.scopeType, input.scopeId, input.name),
      name: input.name,
      scopeType: input.scopeType,
      scopeId: input.scopeId,
      keyId: input.keyId,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      ...(input.label !== undefined ? { label: input.label } : {}),
    }
    this.rows.set(meta.secretId, { meta, sealed: input.sealed })
    return meta
  }
  remove(t: SecretScopeType, s: string, n: string): boolean {
    return this.rows.delete(this.key(t, s, n))
  }
  listByScope(t: SecretScopeType, s: string): SecretMetadata[] {
    return [...this.rows.values()].filter((r) => r.meta.scopeType === t && r.meta.scopeId === s).map((r) => r.meta)
  }
  getByScopeAndName(t: SecretScopeType, s: string, n: string): SecretMetadata | null {
    return this.rows.get(this.key(t, s, n))?.meta ?? null
  }
}

let db: InitializedDatabase
let router: IpcRouter
let runRepository: RunRepository

beforeEach(() => {
  db = initDatabase({ databasePath: ":memory:" })
  const workspaces = new WorkspaceRepository(db.kvStore)
  const workflows = new WorkflowRepository(db.kvStore)
  const runs = new RunRepository(db.kvStore)
  runRepository = runs
  const environments = new EnvironmentRepository(db.kvStore)
  const collections = new CollectionRepository(db.kvStore)
  const existence: ScopeExistence = {
    workspaceExists: (id) => workspaces.getById(id) !== undefined,
    environmentExists: (id) => environments.getById(id) !== undefined,
  }
  const scopeResolver = new ScopeResolver(existence)
  const permissions = new LocalOwnerProvider()
  const sync = new LocalOnlySyncProvider()
  const secretStore = new FakeSecretStore()
  const workflowService = new WorkflowService(workflows, sync, permissions, scopeResolver, collections, environments)
  const runService = new RunService(runs, sync, permissions, scopeResolver)
  const deps: HandlerDeps = {
    workspaces: new WorkspaceService(workspaces, sync, scopeResolver),
    collections: new CollectionService(collections, workflows, sync, permissions, scopeResolver),
    workflows: workflowService,
    workflowAnalysis: new WorkflowAnalysisService(workflowService, runService),
    assertionAuthoring: new AssertionAuthoringService(workflowService, runService),
    environments: new EnvironmentService(environments, sync, permissions, scopeResolver),
    runs: runService,
    secrets: new SecretService(secretStore, sync, permissions, scopeResolver, environments, new Uint8Array(32)),
    projects: new ProjectExportService(
      collections,
      workflows,
      environments,
      sync,
      permissions,
      scopeResolver,
      secretStore,
      () => "2026-01-01T00:00:00.000Z",
    ),
  }
  router = new IpcRouter()
  registerAllHandlers(router, deps)
})

afterEach(() => db.close())

async function dispatchOk<T = unknown>(domain: string, action: string, payload?: unknown): Promise<T> {
  const res = await router.dispatch({ domain, action, payload })
  if (!res.ok) throw new Error(`expected ok, got ${JSON.stringify(res.error)}`)
  return res.data as T
}

/** Connect an in-memory MCP client to a fresh bridge server over the same router. */
async function connectClient(): Promise<Client> {
  const server = createMcpServer(router, "test")
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await server.connect(serverTransport as never)
  const client = new Client({ name: "test-client", version: "1.0.0" })
  await client.connect(clientTransport as never)
  return client
}

/** Like connectClient, but the server is wired to a broker so run resources
 *  advertise subscriptions and emit update notifications. */
async function connectClientWithBroker(broker: RunEventBroker): Promise<Client> {
  const server = createMcpServer(router, "test", broker)
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await server.connect(serverTransport as never)
  const client = new Client({ name: "test-client", version: "1.0.0" })
  await client.connect(clientTransport as never)
  return client
}

function textOf(result: { content: Array<{ type: string; text?: string }> }): string {
  return result.content.map((c) => c.text ?? "").join("")
}

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 20))

describe("MCP whitelist — derived from the IPC registry, drops the right surface", () => {
  it("every whitelisted tool maps to a real IPC handler (no dangling entry)", () => {
    for (const spec of MCP_TOOLS) {
      expect(router.getRegistration(spec.domain, spec.action), `${spec.domain}.${spec.action}`).toBeDefined()
    }
  })

  it("every whitelisted tool carries a non-empty description", () => {
    for (const spec of MCP_TOOLS) {
      expect(spec.description.length, `${spec.domain}.${spec.action}`).toBeGreaterThan(0)
    }
  })

  it("every whitelisted tool declares read/write intent", () => {
    for (const spec of MCP_TOOLS) {
      expect(["read", "write"], `${spec.domain}.${spec.action}`).toContain(spec.intent)
    }
  })

  it("uses unique public names and maps explicit diagnostic and assertion names", () => {
    const names = MCP_TOOLS.map(toolName)
    expect(new Set(names).size).toBe(names.length)
    expect(MCP_TOOLS.find((spec) => toolName(spec) === "workflow_diagnose")).toMatchObject({
      domain: "workflows",
      action: "diagnose",
      intent: "read",
    })
    expect(MCP_TOOLS.find((spec) => toolName(spec) === "assertion_suggest")).toMatchObject({
      domain: "assertions",
      action: "suggest",
      intent: "read",
    })
    expect(MCP_TOOLS.find((spec) => toolName(spec) === "assertion_validate")).toMatchObject({ intent: "read" })
    expect(MCP_TOOLS.find((spec) => toolName(spec) === "assertion_apply")).toMatchObject({ intent: "write" })
  })

  it("excludes keystore mutations and Electron shell/dialog ops", () => {
    const names = new Set(MCP_TOOLS.map((t) => `${t.domain}.${t.action}`))
    for (const excluded of [
      "secrets.set",
      "secrets.delete",
      "runs.getArtifacts",
      "runs.openArtifact",
      "runs.saveArtifactAs",
    ]) {
      expect(names.has(excluded), excluded).toBe(false)
    }
  })

  it("exposes no webhook or import tools (dropped/deferred surface)", () => {
    for (const spec of MCP_TOOLS) {
      expect(spec.domain).not.toBe("webhooks")
      expect(spec.domain).not.toBe("imports")
      expect(spec.domain).not.toBe("cloud")
    }
  })
})

describe("MCP bridge — second transport, parity by construction", () => {
  it("tools/list is non-empty, includes server_info + workflows_list, excludes secrets_set", async () => {
    const client = await connectClient()
    const { tools } = await client.listTools()
    const names = tools.map((t) => t.name)
    expect(names).toContain("workflows_list")
    expect(names).toContain("workflow_diagnose")
    expect(names).toContain("assertion_suggest")
    expect(names).toContain("assertion_validate")
    expect(names).toContain("assertion_apply")
    expect(names).toContain("server_info")
    expect(names).not.toContain("secrets_set")
    expect(names).not.toContain("runs_openArtifact")
    const workflowList = tools.find((tool) => tool.name === "workflows_list")
    const workspaceDelete = tools.find((tool) => tool.name === "workspaces_delete")
    const runCreate = tools.find((tool) => tool.name === "runs_create")
    const workflowDiagnose = tools.find((tool) => tool.name === "workflow_diagnose")
    expect(workflowList?.annotations).toMatchObject({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    })
    expect(workspaceDelete?.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true })
    expect(runCreate?.annotations).toMatchObject({ readOnlyHint: false, openWorldHint: true })
    expect(workflowDiagnose?.annotations).toMatchObject({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    })
    expect(workflowList?.outputSchema).toMatchObject({ type: "object" })
    await client.close()
  })

  it("a tool call returns the SAME body as the IPC dispatch it wraps", async () => {
    const workspace = await dispatchOk<{ workspaceId: string }>("workspaces", "create", { name: "Acme" })
    const created = await dispatchOk<{ workflowId: string }>("workflows", "create", {
      workspaceId: workspace.workspaceId,
      name: "demo",
    })

    const client = await connectClient()
    const toolResult = await client.callTool({
      name: "workflows_list",
      arguments: { workspaceId: workspace.workspaceId },
    })
    const viaTool = JSON.parse(textOf(toolResult as { content: Array<{ type: string; text?: string }> }))
    const viaIpc = await dispatchOk("workflows", "list", { workspaceId: workspace.workspaceId })

    expect(viaTool).toEqual(viaIpc)
    expect((toolResult as { structuredContent?: unknown }).structuredContent).toEqual({ result: viaIpc })
    expect(viaTool.items.map((w: { workflowId: string }) => w.workflowId)).toContain(created.workflowId)
    await client.close()
  })

  it("projects run tools to metadata and drops bodies, headers, URLs, values and assertion messages", async () => {
    const secret = "opaque-value-that-must-never-cross-mcp"
    const workspace = await dispatchOk<{ workspaceId: string }>("workspaces", "create", { name: "Acme" })
    const workflow = await dispatchOk<{ workflowId: string }>("workflows", "create", {
      workspaceId: workspace.workspaceId,
      name: "run projection",
    })
    const run = runRepository.create({ workspaceId: workspace.workspaceId, workflowId: workflow.workflowId })
    runRepository.update(run.runId, {
      variables: { harmlessName: secret },
      nodeStatuses: {
        request: { status: "failed", statusCode: 401, variables: { token: secret }, error: secret, message: secret },
      },
      error: secret,
      failureMessage: secret,
      results: [
        {
          nodeId: "request",
          status: "failed",
          duration: 12,
          request: { method: "GET", url: `https://user:${secret}@example.test/?token=${secret}` },
          response: {
            statusCode: 401,
            headers: { authorization: `Bearer ${secret}` },
            cookies: { session: secret },
            body: { innocuousKey: secret },
          },
          error: secret,
          assertions: [{ outcome: "fail", message: `actual: ${secret}` }],
        },
      ],
    })

    const client = await connectClient()
    const result = await client.callTool({
      name: "runs_get",
      arguments: { workspaceId: workspace.workspaceId, runId: run.runId },
    })
    const text = textOf(result as { content: Array<{ type: string; text?: string }> })
    const parsed = JSON.parse(text) as Record<string, unknown>

    expect(text).not.toContain(secret)
    expect(text).not.toContain("headers")
    expect(text).not.toContain("cookies")
    expect(text).not.toContain("url")
    expect(text).not.toContain("variables")
    expect(text).not.toContain("message")
    expect(text).not.toContain("error\"")
    expect(parsed["hasError"]).toBe(true)
    expect(parsed["nodeStatuses"]).toEqual({ request: { status: "failed", statusCode: 401, hasError: true } })
    expect(parsed["results"]).toEqual([
      expect.objectContaining({
        nodeId: "request",
        status: "failed",
        hasError: true,
        response: { statusCode: 401 },
        assertions: [expect.objectContaining({ outcome: "fail" })],
      }),
    ])
    expect((result as { structuredContent?: unknown }).structuredContent).toEqual({ result: parsed })
    await client.close()
  })

  it("maps an unknown workspace to an isError result carrying not_found (existence-hiding)", async () => {
    const client = await connectClient()
    const result = await client.callTool({
      name: "workflows_get",
      arguments: { workspaceId: "ws-nope", workflowId: "w1" },
    })
    expect((result as { isError?: boolean }).isError).toBe(true)
    expect(textOf(result as { content: Array<{ type: string; text?: string }> })).toContain("not_found")
    await client.close()
  })

  it("diagnoses static and run evidence with IPC parity and no value leakage", async () => {
    const secret = "diagnosis-secret-value"
    const workspace = await dispatchOk<{ workspaceId: string }>("workspaces", "create", { name: "Acme" })
    const workflow = await dispatchOk<{ workflowId: string }>("workflows", "create", {
      workspaceId: workspace.workspaceId,
      name: "diagnose",
      nodes: [
        { nodeId: "start", type: "start", position: { x: 0, y: 0 }, config: {} },
        {
          nodeId: "login",
          type: "http-request",
          position: { x: 100, y: 0 },
          config: { method: "POST", url: "https://example.test/login", extractors: { token: "response.body.token" } },
        },
        { nodeId: "end", type: "end", position: { x: 200, y: 0 }, config: {} },
      ],
      edges: [
        { edgeId: "e1", source: "start", target: "login" },
        { edgeId: "e2", source: "login", target: "end" },
      ],
    })
    const run = runRepository.create({ workspaceId: workspace.workspaceId, workflowId: workflow.workflowId })
    runRepository.update(run.runId, {
      status: "failed",
      variables: { token: secret },
      error: secret,
      failureMessage: secret,
      results: [{
        nodeId: "login",
        status: "failed",
        duration: 12,
        request: { url: `https://example.test/?token=${secret}` },
        response: { statusCode: 401, headers: { authorization: secret }, body: { token: secret } },
        error: secret,
        extractorOutcomes: [{
          producerNodeId: "login",
          variableName: "token",
          path: "response.body.token",
          matched: false,
          observedType: null,
        }],
      }],
    })

    const ipc = await dispatchOk("workflows", "diagnose", {
      workspaceId: workspace.workspaceId,
      workflowId: workflow.workflowId,
      runId: run.runId,
    })
    const client = await connectClient()
    const result = await client.callTool({
      name: "workflow_diagnose",
      arguments: { workspaceId: workspace.workspaceId, workflowId: workflow.workflowId, runId: run.runId },
    })
    const text = textOf(result as { content: Array<{ type: string; text?: string }> })
    const viaMcp = JSON.parse(text) as { diagnostics: Array<{ code: string }> }

    expect(viaMcp).toEqual(ipc)
    expect(viaMcp.diagnostics.map((item) => item.code)).toEqual(expect.arrayContaining([
      "extractor_path_missing",
      "http_request_failed",
    ]))
    expect(text).not.toContain(secret)
    expect(text).not.toContain('"headers":')
    expect(text).not.toContain('"body":')
    expect(text).not.toContain('"url":')
    expect(text).not.toContain("failureMessage")
    expect((result as { structuredContent?: unknown }).structuredContent).toEqual({ result: viaMcp })
    await client.close()
  })

  it("hides a same-workspace run that belongs to another workflow", async () => {
    const workspace = await dispatchOk<{ workspaceId: string }>("workspaces", "create", { name: "Acme" })
    const first = await dispatchOk<{ workflowId: string }>("workflows", "create", {
      workspaceId: workspace.workspaceId,
      name: "first",
    })
    const second = await dispatchOk<{ workflowId: string }>("workflows", "create", {
      workspaceId: workspace.workspaceId,
      name: "second",
    })
    const foreignRun = runRepository.create({ workspaceId: workspace.workspaceId, workflowId: second.workflowId })
    const client = await connectClient()
    const result = await client.callTool({
      name: "workflow_diagnose",
      arguments: { workspaceId: workspace.workspaceId, workflowId: first.workflowId, runId: foreignRun.runId },
    })

    expect((result as { isError?: boolean }).isError).toBe(true)
    expect(textOf(result as { content: Array<{ type: string; text?: string }> })).toContain("not_found")
    await client.close()
  })

  it("suggests, validates, and revision-applies assertions through the shared IPC/MCP path", async () => {
    const secret = "Bearer mcp-observed-secret"
    const workspace = await dispatchOk<{ workspaceId: string }>("workspaces", "create", { name: "Acme" })
    const workflow = await dispatchOk<{ workflowId: string; rev: number }>("workflows", "create", {
      workspaceId: workspace.workspaceId,
      name: "author assertions",
      nodes: [
        { nodeId: "start", type: "start", position: { x: 0, y: 0 }, config: {} },
        { nodeId: "request", type: "http-request", position: { x: 100, y: 0 }, config: {} },
        { nodeId: "assert", type: "assertion", position: { x: 200, y: 0 }, config: { assertions: [] } },
      ],
      edges: [
        { edgeId: "e1", source: "start", target: "request" },
        { edgeId: "e2", source: "request", target: "assert" },
      ],
    })
    const run = runRepository.create({ workspaceId: workspace.workspaceId, workflowId: workflow.workflowId })
    runRepository.update(run.runId, {
      results: [{
        nodeId: "request",
        status: "passed",
        duration: 37,
        response: {
          statusCode: 200,
          headers: { "content-type": "application/json" },
          body: { ready: true, token: secret },
        },
      }],
    })

    const suggestArgs = {
      workspaceId: workspace.workspaceId,
      workflowId: workflow.workflowId,
      runId: run.runId,
      sourceNodeId: "request",
    }
    const viaIpc = await dispatchOk("assertions", "suggest", suggestArgs)
    const client = await connectClient()
    const suggested = await client.callTool({ name: "assertion_suggest", arguments: suggestArgs })
    const viaMcp = JSON.parse(textOf(suggested as { content: Array<{ type: string; text?: string }> }))
    expect(viaMcp).toEqual(viaIpc)
    expect(JSON.stringify(viaMcp)).not.toContain(secret)

    const validateArgs = {
      ...suggestArgs,
      rules: [{ source: "prev", path: "body.ready", operator: "exists" }],
    }
    const validatedIpc = await dispatchOk("assertions", "validate", validateArgs)
    const validated = await client.callTool({ name: "assertion_validate", arguments: validateArgs })
    expect(JSON.parse(textOf(validated as { content: Array<{ type: string; text?: string }> }))).toEqual(validatedIpc)

    const applyArgs = {
      workspaceId: workspace.workspaceId,
      workflowId: workflow.workflowId,
      expectedRevision: workflow.rev,
      assertionNodeId: "assert",
      mode: "append",
      rules: [{ source: "prev", path: "response.body.ready", operator: "exists" }],
    }
    const applied = await client.callTool({ name: "assertion_apply", arguments: applyArgs })
    const appliedBody = JSON.parse(textOf(applied as { content: Array<{ type: string; text?: string }> })) as {
      revision: number
      workflow: { nodes: Array<{ nodeId: string; config?: { assertions?: unknown[] } }> }
    }
    const persisted = await dispatchOk<{ rev: number; nodes: Array<{ nodeId: string; config?: { assertions?: unknown[] } }> }>(
      "workflows",
      "get",
      { workspaceId: workspace.workspaceId, workflowId: workflow.workflowId },
    )
    expect(appliedBody.revision).toBe(persisted.rev)
    expect(appliedBody.workflow.nodes.find((node) => node.nodeId === "assert")?.config?.assertions).toEqual([
      { source: "prev", path: "response.body.ready", operator: "exists" },
    ])

    const stale = await client.callTool({ name: "assertion_apply", arguments: applyArgs })
    expect((stale as { isError?: boolean }).isError).toBe(true)
    expect(textOf(stale as { content: Array<{ type: string; text?: string }> })).toContain("conflict")
    await client.close()
  })
})

describe("MCP resources — read-only safe run snapshot", () => {
  const runUri = (workspaceId: string, runId: string): string =>
    `apiweave://workspaces/${workspaceId}/runs/${runId}`

  it("advertises the run resource template via resources/templates/list", async () => {
    const client = await connectClient()
    const { resourceTemplates } = await client.listResourceTemplates()
    const run = resourceTemplates.find((t) => t.name === "run-snapshot")
    expect(run?.uriTemplate).toBe("apiweave://workspaces/{workspaceId}/runs/{runId}")
    expect(run?.mimeType).toBe("application/json")
    await client.close()
  })

  it("reads a metadata-only snapshot and drops bodies, headers, URLs, values and messages", async () => {
    const secret = "resource-secret-must-never-cross-mcp"
    const workspace = await dispatchOk<{ workspaceId: string }>("workspaces", "create", { name: "Acme" })
    const workflow = await dispatchOk<{ workflowId: string }>("workflows", "create", {
      workspaceId: workspace.workspaceId,
      name: "snapshot",
    })
    const run = runRepository.create({ workspaceId: workspace.workspaceId, workflowId: workflow.workflowId })
    runRepository.update(run.runId, {
      status: "failed",
      duration: 842,
      startedAt: "2026-07-27T12:00:00.000Z",
      variables: { token: secret },
      error: secret,
      failureMessage: secret,
      nodeStatuses: { login: { status: "passed", statusCode: 200 } },
      results: [
        {
          nodeId: "login",
          status: "passed",
          duration: 184,
          request: { method: "GET", url: `https://user:${secret}@example.test/?token=${secret}` },
          response: { statusCode: 200, headers: { authorization: `Bearer ${secret}` }, body: { token: secret } },
        },
      ],
    })

    const client = await connectClient()
    const uri = runUri(workspace.workspaceId, run.runId)
    const result = await client.readResource({ uri })
    expect(result.contents).toHaveLength(1)
    const content = result.contents[0] as { uri: string; mimeType?: string; text: string }
    expect(content.uri).toBe(uri)
    expect(content.mimeType).toBe("application/json")

    expect(content.text).not.toContain(secret)
    expect(content.text).not.toContain("headers")
    expect(content.text).not.toContain("cookies")
    expect(content.text).not.toContain("url")
    expect(content.text).not.toContain("message")

    const snapshot = JSON.parse(content.text) as Record<string, unknown>
    expect(snapshot).toMatchObject({
      runId: run.runId,
      workflowId: workflow.workflowId,
      status: "failed",
      terminal: true,
      durationMs: 842,
      hasError: true,
      nodes: { login: { status: "passed", statusCode: 200, durationMs: 184 } },
    })
    await client.close()
  })

  it("hides a run in another workspace (existence-hiding read)", async () => {
    const workspace = await dispatchOk<{ workspaceId: string }>("workspaces", "create", { name: "Acme" })
    const workflow = await dispatchOk<{ workflowId: string }>("workflows", "create", {
      workspaceId: workspace.workspaceId,
      name: "owned",
    })
    const run = runRepository.create({ workspaceId: workspace.workspaceId, workflowId: workflow.workflowId })

    const client = await connectClient()
    await expect(client.readResource({ uri: runUri("ws-not-mine", run.runId) })).rejects.toThrow(/not_found/)
    await client.close()
  })
})

describe("MCP resources — live subscriptions over the run event broker", () => {
  const runUri = (workspaceId: string, runId: string): string =>
    `apiweave://workspaces/${workspaceId}/runs/${runId}`

  async function seedRun(): Promise<{ workspaceId: string; runId: string }> {
    const workspace = await dispatchOk<{ workspaceId: string }>("workspaces", "create", { name: "Acme" })
    const workflow = await dispatchOk<{ workflowId: string }>("workflows", "create", {
      workspaceId: workspace.workspaceId,
      name: "subscribed",
    })
    const run = runRepository.create({ workspaceId: workspace.workspaceId, workflowId: workflow.workflowId })
    return { workspaceId: workspace.workspaceId, runId: run.runId }
  }

  it("advertises subscribe capability only when a broker is wired", async () => {
    const withBroker = await connectClientWithBroker(new RunEventBroker({ now: () => "t" }))
    expect(withBroker.getServerCapabilities()?.resources?.subscribe).toBe(true)
    await withBroker.close()

    const withoutBroker = await connectClient()
    expect(withoutBroker.getServerCapabilities()?.resources?.subscribe).toBeFalsy()
    await withoutBroker.close()
  })

  it("notifies a subscriber on each transition of its run and re-reads a newer sequence", async () => {
    let n = 0
    const broker = new RunEventBroker({ now: () => `t${++n}` })
    const { workspaceId, runId } = await seedRun()
    const uri = runUri(workspaceId, runId)

    const client = await connectClientWithBroker(broker)
    const notified: string[] = []
    client.setNotificationHandler(ResourceUpdatedNotificationSchema, (note) => {
      notified.push(note.params.uri)
    })
    await client.subscribeResource({ uri })

    broker.publish(runId, { kind: "run.started", runId })
    broker.publish(runId, { kind: "node.status", runId, nodeId: "a", status: "passed", variables: {} })
    await tick()

    expect(notified.filter((u) => u === uri).length).toBeGreaterThanOrEqual(2)
    const read = await client.readResource({ uri })
    const snapshot = JSON.parse((read.contents[0] as { text: string }).text) as { latestSequence: number }
    expect(snapshot.latestSequence).toBe(broker.getLatestSequence(runId))
    expect(snapshot.latestSequence).toBeGreaterThan(0)
    await client.close()
  })

  it("does not notify a client about a run it did not subscribe to (isolation)", async () => {
    const broker = new RunEventBroker({ now: () => "t" })
    const a = await seedRun()
    const b = await seedRun()

    const client = await connectClientWithBroker(broker)
    const notified: string[] = []
    client.setNotificationHandler(ResourceUpdatedNotificationSchema, (note) => {
      notified.push(note.params.uri)
    })
    await client.subscribeResource({ uri: runUri(a.workspaceId, a.runId) })

    broker.publish(b.runId, { kind: "run.started", runId: b.runId })
    await tick()
    expect(notified).toHaveLength(0)

    broker.publish(a.runId, { kind: "run.started", runId: a.runId })
    await tick()
    expect(notified).toEqual([runUri(a.workspaceId, a.runId)])
    await client.close()
  })

  it("stops notifying after unsubscribe and after the session closes (no listener leak)", async () => {
    const broker = new RunEventBroker({ now: () => "t" })
    const { workspaceId, runId } = await seedRun()
    const uri = runUri(workspaceId, runId)

    const client = await connectClientWithBroker(broker)
    const notified: string[] = []
    client.setNotificationHandler(ResourceUpdatedNotificationSchema, (note) => {
      notified.push(note.params.uri)
    })
    await client.subscribeResource({ uri })
    await client.unsubscribeResource({ uri })

    broker.publish(runId, { kind: "run.started", runId })
    await tick()
    expect(notified).toHaveLength(0)

    // A fresh subscription then a session close must also detach the listener.
    const client2 = await connectClientWithBroker(broker)
    await client2.subscribeResource({ uri })
    await client2.close()
    // No throw and no delivery target — the broker fan-out stays clean.
    expect(() => broker.publish(runId, { kind: "run.finished", runId, status: "completed" })).not.toThrow()
  })
})

describe("MCP bridge — inherited secret masking holds across read/export tools", () => {
  const PLAINTEXT = "super-secret-value-1234"

  it("workflows_get, secrets_list and projects_export never surface the secret value", async () => {
    const workspace = await dispatchOk<{ workspaceId: string }>("workspaces", "create", { name: "Acme" })
    await dispatchOk("secrets", "set", {
      workspaceId: workspace.workspaceId,
      name: "TEST_KEY",
      scopeType: "workspace",
      scopeId: workspace.workspaceId,
      keyId: "k1",
      sealed: new TextEncoder().encode(PLAINTEXT),
    })
    const collection = await dispatchOk<{ collectionId: string }>("projects", "create", {
      workspaceId: workspace.workspaceId,
      name: "Col",
    })
    const workflow = await dispatchOk<{ workflowId: string }>("workflows", "create", {
      workspaceId: workspace.workspaceId,
      name: "wf",
      collectionId: collection.collectionId,
      variables: { auth: "{{secrets.TEST_KEY}}" },
    })

    const client = await connectClient()
    const calls = [
      client.callTool({ name: "workflows_get", arguments: { workspaceId: workspace.workspaceId, workflowId: workflow.workflowId } }),
      client.callTool({ name: "secrets_list", arguments: { workspaceId: workspace.workspaceId, scopeType: "workspace", scopeId: workspace.workspaceId } }),
      client.callTool({ name: "projects_export", arguments: { workspaceId: workspace.workspaceId, projectId: collection.collectionId } }),
    ]
    for (const call of calls) {
      const text = textOf((await call) as { content: Array<{ type: string; text?: string }> })
      expect(text).not.toContain(PLAINTEXT)
    }
    await client.close()
  })
})

describe("MCP prompts — agent-mediated assertion authoring (no embedded LLM)", () => {
  it("ships exactly the author_assertions prompt with canonical guidance", () => {
    expect(MCP_PROMPTS.map((p) => p.name)).toEqual(["author_assertions"])
    const { messages } = AUTHOR_ASSERTIONS_PROMPT.build({})
    const text = messages.map((m) => (m.content.type === "text" ? m.content.text : "")).join("")
    // Canonical sources + operators are pulled from the shared enums — assert a few hold.
    for (const source of ["prev", "variables", "status", "cookies", "headers"]) {
      expect(text).toContain(source)
    }
    for (const operator of ["equals", "exists", "count", "gte"]) {
      expect(text).toContain(operator)
    }
    // The flow: validate → approve → apply, plus the secret-literal safety rule.
    expect(text).toContain("assertion_validate")
    expect(text).toContain("assertion_apply")
    expect(text).toContain("expectedRevision")
    expect(text).toContain("{{secrets.NAME}}")
    expect(text).toContain("approval")
  })

  it("weaves supplied context but embeds none by default", () => {
    const bare = AUTHOR_ASSERTIONS_PROMPT.build({})
    const bareText = bare.messages.map((m) => (m.content.type === "text" ? m.content.text : "")).join("")
    expect(bareText).not.toContain("workspaceId: ")
    expect(bareText).toContain("No workflow/run context was supplied")

    const withCtx = AUTHOR_ASSERTIONS_PROMPT.build({ workspaceId: "ws-1", workflowId: "wf-2", runId: "run-3" })
    const ctxText = withCtx.messages.map((m) => (m.content.type === "text" ? m.content.text : "")).join("")
    expect(ctxText).toContain("workspaceId: ws-1")
    expect(ctxText).toContain("workflowId: wf-2")
    expect(ctxText).toContain("runId: run-3")
  })

  it("discovers and reads the prompt over an in-memory MCP client", async () => {
    const client = await connectClient()
    const { prompts } = await client.listPrompts()
    expect(prompts.map((p) => p.name)).toContain("author_assertions")

    const result = await client.getPrompt({ name: "author_assertions", arguments: { workflowId: "wf-42" } })
    const text = result.messages.map((m) => (m.content.type === "text" ? m.content.text : "")).join("")
    expect(text).toContain("workflowId: wf-42")
    expect(text).toContain("assertion_validate")
    await client.close()
  })

  it("an agent following the prompt validates then revision-applies over the same client", async () => {
    const workspace = await dispatchOk<{ workspaceId: string }>("workspaces", "create", { name: "Acme" })
    const workflow = await dispatchOk<{ workflowId: string; rev: number }>("workflows", "create", {
      workspaceId: workspace.workspaceId,
      name: "prompt-driven authoring",
      nodes: [
        { nodeId: "start", type: "start", position: { x: 0, y: 0 }, config: {} },
        { nodeId: "request", type: "http-request", position: { x: 100, y: 0 }, config: {} },
        { nodeId: "assert", type: "assertion", position: { x: 200, y: 0 }, config: { assertions: [] } },
      ],
      edges: [
        { edgeId: "e1", source: "start", target: "request" },
        { edgeId: "e2", source: "request", target: "assert" },
      ],
    })

    const client = await connectClient()
    // Step 1: the client fetches the prompt (the natural-language steering text).
    await client.getPrompt({
      name: "author_assertions",
      arguments: { workspaceId: workspace.workspaceId, workflowId: workflow.workflowId, assertionNodeId: "assert" },
    })

    // Step 2: validate the translated rules before mutating anything.
    const rules = [{ source: "status", path: "", operator: "equals", expectedValue: 200 }]
    const validated = await client.callTool({
      name: "assertion_validate",
      arguments: { workspaceId: workspace.workspaceId, workflowId: workflow.workflowId, sourceNodeId: "request", rules },
    })
    const validation = JSON.parse(textOf(validated as { content: Array<{ type: string; text?: string }> })) as {
      valid: boolean
    }
    expect(validation.valid).toBe(true)

    // Step 3: apply under the current revision.
    const applied = await client.callTool({
      name: "assertion_apply",
      arguments: {
        workspaceId: workspace.workspaceId,
        workflowId: workflow.workflowId,
        expectedRevision: workflow.rev,
        assertionNodeId: "assert",
        mode: "append",
        rules,
      },
    })
    expect((applied as { isError?: boolean }).isError).toBeFalsy()
    const persisted = await dispatchOk<{ nodes: Array<{ nodeId: string; config?: { assertions?: unknown[] } }> }>(
      "workflows",
      "get",
      { workspaceId: workspace.workspaceId, workflowId: workflow.workflowId },
    )
    expect(persisted.nodes.find((n) => n.nodeId === "assert")?.config?.assertions).toEqual(rules)
    await client.close()
  })
})

describe("McpHost — loopback bind, bearer auth, port fallback", () => {
  let host: McpHost | null = null
  const tokenPath = join(tmpdir(), `apiweave-mcp-token-${process.pid}.json`)

  afterEach(async () => {
    if (host) await host.stop()
    host = null
    try {
      rmSync(tokenPath)
    } catch {
      /* ignore */
    }
  })

  async function request(
    port: number,
    method: string,
    path: string,
    headers: Record<string, string>,
    body?: unknown,
  ): Promise<{ status: number; text: string }> {
    const payload = body === undefined ? "" : JSON.stringify(body)
    return await new Promise((resolve, reject) => {
      const req = http.request(
        {
          host: "127.0.0.1",
          port,
          path,
          method,
          // Streamable HTTP requires the client to accept both JSON and the SSE type.
          headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers },
        },
        (res) => {
          const chunks: Buffer[] = []
          res.on("data", (c: Buffer) => chunks.push(c))
          res.on("end", () => resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString("utf8") }))
        },
      )
      req.on("error", reject)
      req.end(payload)
    })
  }

  function post(port: number, headers: Record<string, string>, body: unknown): Promise<{ status: number; text: string }> {
    return request(port, "POST", "/mcp", headers, body)
  }

  const listBody = { jsonrpc: "2.0", method: "tools/list", id: 1 }

  it("rejects missing and wrong tokens, accepts the correct one", async () => {
    host = new McpHost({ router, tokenFilePath: tokenPath, version: "test", preferredPort: 0 })
    const { token, port } = await host.start()

    expect((await post(port, {}, listBody)).status).toBe(401)
    expect((await post(port, { authorization: "Bearer wrong" }, listBody)).status).toBe(401)

    const ok = await post(port, { authorization: `Bearer ${token}` }, listBody)
    expect(ok.status).toBe(200)
    expect(ok.text).toContain("workflows_list")
  })

  it("rejects hostile browser origins and accepts native or loopback callers", async () => {
    host = new McpHost({ router, tokenFilePath: tokenPath, version: "test", preferredPort: 0 })
    const { token, port } = await host.start()
    const authorization = `Bearer ${token}`

    expect((await post(port, { authorization, origin: "https://attacker.example" }, listBody)).status).toBe(403)
    expect((await post(port, { authorization, origin: "null" }, listBody)).status).toBe(403)
    expect((await post(port, { authorization, origin: "app://local" }, listBody)).status).toBe(200)
    expect((await post(port, { authorization, origin: `http://127.0.0.1:${port}` }, listBody)).status).toBe(200)
    expect((await post(port, { authorization }, listBody)).status).toBe(200)
  })

  it("returns bounded errors for wrong paths, methods and declared oversized bodies", async () => {
    host = new McpHost({ router, tokenFilePath: tokenPath, version: "test", preferredPort: 0, maxBodyBytes: 32 })
    const { token, port } = await host.start()
    const authorization = `Bearer ${token}`

    expect((await request(port, "POST", "/wrong", { authorization }, listBody)).status).toBe(404)
    expect((await request(port, "GET", "/mcp", {}, undefined)).status).toBe(401)
    // GET/DELETE without an established session are bad requests (no session to drive).
    expect((await request(port, "GET", "/mcp", { authorization }, undefined)).status).toBe(400)
    expect((await request(port, "DELETE", "/mcp", { authorization }, undefined)).status).toBe(400)
    // A truly unsupported method is still 405.
    expect((await request(port, "PUT", "/mcp", { authorization }, listBody)).status).toBe(405)
    expect((await post(port, { authorization }, { payload: "x".repeat(64) })).status).toBe(413)
  })

  it("binds 127.0.0.1 only and persists { token, port }", async () => {
    host = new McpHost({ router, tokenFilePath: tokenPath, version: "test", preferredPort: 0 })
    const info = await host.start()
    const config = host.getConfig()
    expect(config?.url).toBe(`http://127.0.0.1:${info.port}/mcp`)
    const saved = JSON.parse(readFileSync(tokenPath, "utf8"))
    expect(saved).toMatchObject({ token: info.token, port: info.port })
  })

  it("falls back to an ephemeral port when the preferred port is taken", async () => {
    // Occupy a port, then ask the host to prefer it → it must bind elsewhere, not fail.
    const squatter = http.createServer()
    const squatterPort = await new Promise<number>((resolve) => {
      squatter.listen(0, "127.0.0.1", () => resolve((squatter.address() as { port: number }).port))
    })

    host = new McpHost({ router, tokenFilePath: tokenPath, version: "test", preferredPort: squatterPort })
    const info = await host.start()
    expect(info.port).not.toBe(squatterPort)
    expect(info.port).toBeGreaterThan(0)

    const ok = await post(info.port, { authorization: `Bearer ${info.token}` }, listBody)
    expect(ok.status).toBe(200)

    await new Promise<void>((resolve) => squatter.close(() => resolve()))
  })

  it("concurrent start() calls bind exactly one server and agree on the port", async () => {
    host = new McpHost({ router, tokenFilePath: tokenPath, version: "test", preferredPort: 0 })
    const [a, b, c] = await Promise.all([host.start(), host.start(), host.start()])
    expect(a.port).toBe(b.port)
    expect(b.port).toBe(c.port)

    // Only one server is actually listening: stop() must close it, and a
    // post-stop request must fail to connect rather than reach an orphan.
    await host.stop()
    await expect(post(a.port, { authorization: `Bearer ${a.token}` }, listBody)).rejects.toThrow()
  })

  it("a stop() racing an in-flight start() leaves no orphaned listener", async () => {
    host = new McpHost({ router, tokenFilePath: tokenPath, version: "test", preferredPort: 0 })
    const [info] = await Promise.all([host.start(), host.stop()])

    expect(host.isRunning()).toBe(false)
    await expect(post(info.port, { authorization: `Bearer ${info.token}` }, listBody)).rejects.toThrow()
  })
})

describe("McpHost — stateful sessions and live run subscriptions over HTTP", () => {
  let host: McpHost | null = null
  let broker: RunEventBroker
  const tokenPath = join(tmpdir(), `apiweave-mcp-session-${process.pid}.json`)
  const clients: Client[] = []

  beforeEach(() => {
    broker = new RunEventBroker({ now: () => "2026-07-27T00:00:00.000Z" })
  })

  afterEach(async () => {
    for (const c of clients.splice(0)) {
      try {
        await c.close()
      } catch {
        /* ignore */
      }
    }
    if (host) await host.stop()
    host = null
    try {
      rmSync(tokenPath)
    } catch {
      /* ignore */
    }
  })

  async function connectHttp(port: number, token: string): Promise<Client> {
    const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), {
      requestInit: { headers: { authorization: `Bearer ${token}` } },
    })
    const client = new Client({ name: "http-client", version: "1.0.0" })
    await client.connect(transport)
    clients.push(client)
    return client
  }

  async function seedRun(): Promise<{ workspaceId: string; runId: string }> {
    const workspace = await dispatchOk<{ workspaceId: string }>("workspaces", "create", { name: "Acme" })
    const workflow = await dispatchOk<{ workflowId: string }>("workflows", "create", {
      workspaceId: workspace.workspaceId,
      name: "http-subscribed",
    })
    const run = runRepository.create({ workspaceId: workspace.workspaceId, workflowId: workflow.workflowId })
    return { workspaceId: workspace.workspaceId, runId: run.runId }
  }

  it("initializes a session and lists tools over the retained transport", async () => {
    host = new McpHost({ router, tokenFilePath: tokenPath, version: "test", preferredPort: 0, broker })
    const { token, port } = await host.start()

    const client = await connectHttp(port, token)
    const { tools } = await client.listTools()
    expect(tools.map((t) => t.name)).toContain("workflows_list")
    expect(host.getSessionCount()).toBe(1)
  })

  it("gives two clients isolated sessions", async () => {
    host = new McpHost({ router, tokenFilePath: tokenPath, version: "test", preferredPort: 0, broker })
    const { token, port } = await host.start()

    const a = await connectHttp(port, token)
    const b = await connectHttp(port, token)
    const idA = (a.transport as StreamableHTTPClientTransport).sessionId
    const idB = (b.transport as StreamableHTTPClientTransport).sessionId
    expect(idA).toBeDefined()
    expect(idB).toBeDefined()
    expect(idA).not.toBe(idB)
    expect(host.getSessionCount()).toBe(2)
  })

  it("delivers resource-updated notifications only to a subscribed session", async () => {
    host = new McpHost({ router, tokenFilePath: tokenPath, version: "test", preferredPort: 0, broker })
    const { token, port } = await host.start()
    const { workspaceId, runId } = await seedRun()
    const uri = `apiweave://workspaces/${workspaceId}/runs/${runId}`

    const client = await connectHttp(port, token)
    const notified: string[] = []
    client.setNotificationHandler(ResourceUpdatedNotificationSchema, (note) => {
      notified.push(note.params.uri)
    })
    await client.subscribeResource({ uri })

    broker.publish(runId, { kind: "run.started", runId })
    broker.publish(runId, { kind: "run.finished", runId, status: "completed" })

    // The notification rides the GET SSE stream — allow it to arrive.
    for (let i = 0; i < 50 && notified.length < 1; i++) {
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    expect(notified).toContain(uri)

    const read = await client.readResource({ uri })
    const snapshot = JSON.parse((read.contents[0] as { text: string }).text) as { latestSequence: number }
    expect(snapshot.latestSequence).toBe(broker.getLatestSequence(runId))
  })

  it("removes a session on DELETE (terminateSession) with no leaked listener", async () => {
    host = new McpHost({ router, tokenFilePath: tokenPath, version: "test", preferredPort: 0, broker })
    const { token, port } = await host.start()
    const { workspaceId, runId } = await seedRun()

    const client = await connectHttp(port, token)
    await client.subscribeResource({ uri: `apiweave://workspaces/${workspaceId}/runs/${runId}` })
    expect(host.getSessionCount()).toBe(1)

    await (client.transport as StreamableHTTPClientTransport).terminateSession()
    for (let i = 0; i < 50 && host.getSessionCount() > 0; i++) {
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    expect(host.getSessionCount()).toBe(0)
    // Broker fan-out stays clean after the subscribing session is gone (its
    // resource-subscription listener was detached on session close).
    expect(() => broker.publish(runId, { kind: "run.finished", runId, status: "completed" })).not.toThrow()
  })

  it("evicts an idle session after the idle timeout", async () => {
    host = new McpHost({
      router,
      tokenFilePath: tokenPath,
      version: "test",
      preferredPort: 0,
      broker,
      idleTimeoutMs: 80,
    })
    const { token, port } = await host.start()
    await connectHttp(port, token)
    expect(host.getSessionCount()).toBe(1)

    for (let i = 0; i < 50 && host.getSessionCount() > 0; i++) {
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    expect(host.getSessionCount()).toBe(0)
  })

  it("rejects a new session past the max-sessions limit", async () => {
    host = new McpHost({ router, tokenFilePath: tokenPath, version: "test", preferredPort: 0, broker, maxSessions: 1 })
    const { token, port } = await host.start()

    await connectHttp(port, token)
    expect(host.getSessionCount()).toBe(1)
    await expect(connectHttp(port, token)).rejects.toThrow()
  })
})
