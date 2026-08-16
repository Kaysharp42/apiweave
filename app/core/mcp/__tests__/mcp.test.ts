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
  NodePresetRepository,
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
import { NodePresetService } from "../../services/node_preset_service"
import { RunService } from "../../services/run_service"
import { SecretService, type SecretWriteStore, type SecretUpsert } from "../../services/secret_service"
import { ProjectExportService } from "../../services/project_export_service"
import type { SecretMetadata, SecretScopeType } from "../../secrets/scoped_secret_resolver"
import { IpcRouter } from "../../ipc/router"
import { registerAllHandlers, type HandlerDeps } from "../../ipc/handlers"
import { MCP_TOOLS, toolName } from "../tools"
import { MCP_PROMPTS, AUTHOR_ASSERTIONS_PROMPT } from "../prompts"
import { MCP_GUIDES, guideUri } from "../guide"
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
  const nodePresets = new NodePresetRepository(db.kvStore)
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
    nodePresets: new NodePresetService(nodePresets, permissions, scopeResolver),
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
    httpSafety: {
      allowPrivateNetworks: false,
      setAllowPrivateNetworks: () => undefined,
    },
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

/** Budget for the tests that poll for an async delivery (SSE notification,
 *  session teardown). The poll loops exit as soon as the condition holds, so
 *  this bounds a hang; it must exceed the loop's own ceiling or the default 5s
 *  timeout fires first and reports a timeout instead of the real assertion. */
const POLL_TEST_TIMEOUT_MS = 20_000

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

  /**
   * The agents surface spawns processes with a caller-influenced working
   * directory. The MCP bridge is a second transport over the same router, so
   * anything reachable there is reachable by a local agent over loopback HTTP —
   * which would turn "an agent can drive APIWeave" into "an agent can execute
   * arbitrary code". It is kept off the router entirely (a privileged preload
   * world instead), and this asserts it stays that way.
   */
  it("exposes no agents tools — agent launching is not on the router at all", () => {
    for (const spec of MCP_TOOLS) {
      expect(spec.domain).not.toBe("agents")
    }
    const names = new Set(MCP_TOOLS.map((t) => `${t.domain}.${t.action}`))
    for (const excluded of ["agents.launchExternal", "agents.chooseLocalPath", "agents.saveCustomAgent"]) {
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

  it("runs_getNodeResult returns the stored body for one node, with secret-looking values redacted", async () => {
    const responseSecret = "Bearer sensitive-token-that-must-leave-redacted"
    const workspace = await dispatchOk<{ workspaceId: string }>("workspaces", "create", { name: "Acme" })
    const workflow = await dispatchOk<{ workflowId: string }>("workflows", "create", {
      workspaceId: workspace.workspaceId,
      name: "node-result",
    })
    const run = runRepository.create({ workspaceId: workspace.workspaceId, workflowId: workflow.workflowId })
    runRepository.update(run.runId, {
      results: [
        {
          nodeId: "mc-create",
          status: "failed",
          duration: 4,
          request: { method: "POST", url: "https://example.test/policies", body: "{\"name\":\"whatever\"}" },
          response: {
            statusCode: 404,
            headers: { "content-type": "application/json", authorization: responseSecret },
            body: { error: "LEGAL_CATEGORY_NOT_FOUND", ref: "ROLE_NOT_FOUND" },
          },
          error: "Request configuration invalid",
        },
      ],
    })

    const client = await connectClient()
    const toolResult = await client.callTool({
      name: "runs_getNodeResult",
      arguments: { workspaceId: workspace.workspaceId, runId: run.runId, nodeId: "mc-create" },
    })
    const text = textOf(toolResult as { content: Array<{ type: string; text?: string }> })
    const parsed = JSON.parse(text) as {
      nodeId: string
      status: string
      request: { url: string; body?: string }
      response: { statusCode: number; headers: Record<string, string>; body: { error: string; ref: string } }
    }

    // Body is exposed — the failure detail the target service returned is what
    // makes this tool worth having, instead of the bare 404 the metadata-only
    // `runs.get` returns:
    expect(parsed.response.body).toEqual({ error: "LEGAL_CATEGORY_NOT_FOUND", ref: "ROLE_NOT_FOUND" })
    expect(parsed.response.statusCode).toBe(404)
    expect(parsed.nodeId).toBe("mc-create")
    expect(parsed.status).toBe("failed")
    // The same secret-redaction pass every MCP read applies still runs (the
    // transport redacts Authorization headers and secret-looking strings):
    expect(text).not.toContain(responseSecret)
    await client.close()
  })

  it("runs_getNodeResult hides whether a nodeId is unknown with not_found (existence parity)", async () => {
    const workspace = await dispatchOk<{ workspaceId: string }>("workspaces", "create", { name: "Acme" })
    const workflow = await dispatchOk<{ workflowId: string }>("workflows", "create", {
      workspaceId: workspace.workspaceId,
      name: "missing-node",
    })
    const run = runRepository.create({ workspaceId: workspace.workspaceId, workflowId: workflow.workflowId })

    const client = await connectClient()
    const result = await client.callTool({
      name: "runs_getNodeResult",
      arguments: { workspaceId: workspace.workspaceId, runId: run.runId, nodeId: "nope" },
    })
    expect((result as { isError?: boolean }).isError).toBe(true)
    expect(textOf(result as { content: Array<{ type: string; text?: string }> })).toContain("not_found")
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

describe("MCP guides — the conventions are discoverable without reverse-engineering", () => {
  it("lists every guide as a concrete resource, not a template only", async () => {
    const client = await connectClient()
    const { resources } = await client.listResources()
    const uris = resources.map((resource) => resource.uri)

    // The complaint this fixes: resources/list answered [] because the only
    // resource was a template, so an agent saw an undocumented server.
    expect(resources.length).toBeGreaterThan(0)
    for (const guide of MCP_GUIDES) expect(uris).toContain(guideUri(guide.slug))
    await client.close()
  })

  it("serves each guide as readable markdown", async () => {
    const client = await connectClient()
    for (const guide of MCP_GUIDES) {
      const read = await client.readResource({ uri: guideUri(guide.slug) })
      const contents = read.contents[0] as { mimeType?: string; text?: string }
      expect(contents.mimeType).toBe("text/markdown")
      expect(contents.text).toBe(guide.text)
    }
    await client.close()
  })

  it("documents the two conventions that are invisible in the JSON schemas", async () => {
    const client = await connectClient()
    const authoring = (await client.readResource({ uri: guideUri("workflow-authoring") }))
      .contents[0] as { text: string }
    const assertions = (await client.readResource({ uri: guideUri("assertions") }))
      .contents[0] as { text: string }

    expect(authoring.text).toContain("sourceHandle")
    expect(authoring.text).toContain('"pass"')
    expect(authoring.text).toContain('"fail"')
    expect(assertions.text).toContain("response.body.id")
    await client.close()
  })

  it("points at the guides from server_info, for clients that never read resources", async () => {
    const client = await connectClient()
    const info = JSON.parse(
      textOf((await client.callTool({ name: "server_info", arguments: {} })) as {
        content: Array<{ type: string; text?: string }>
      }),
    ) as { guides: Array<{ uri: string; title: string }> }
    expect(info.guides.map((guide) => guide.uri)).toEqual(MCP_GUIDES.map((guide) => guideUri(guide.slug)))
    await client.close()
  })

  it("carries the edge-handle and assertion-path rules in the tool input schemas", async () => {
    const client = await connectClient()
    const tools = (await client.listTools()).tools
    const createSchema = JSON.stringify(tools.find((tool) => tool.name === "workflows_create")?.inputSchema)

    // Field descriptions are the only prose that reaches a client rendering the
    // schema, so the two costly conventions have to survive into it.
    expect(createSchema).toContain("pass")
    expect(createSchema).toContain("fail")
    expect(createSchema).toContain("response.body")
    await client.close()
  })
})

describe("MCP graph writes — mistakes surface statically, before any live request", () => {
  const brokenGraph = {
    name: "unhandled assertion",
    nodes: [
      { nodeId: "start", type: "start", position: { x: 0, y: 0 } },
      { nodeId: "request", type: "http-request", position: { x: 100, y: 0 }, config: {} },
      {
        nodeId: "assert",
        type: "assertion",
        position: { x: 200, y: 0 },
        // `id` is the bare-field-name mistake: the value lives at response.body.id.
        config: { assertions: [{ source: "prev", path: "id", operator: "exists" }] },
      },
      { nodeId: "end", type: "end", position: { x: 300, y: 0 } },
    ],
    edges: [
      { edgeId: "e1", source: "start", target: "request" },
      { edgeId: "e2", source: "request", target: "assert" },
      // No sourceHandle: the branch would stop silently mid-run.
      { edgeId: "e3", source: "assert", target: "end" },
    ],
  }

  it("returns a diagnosis with the write, so a bad graph never needs a run to be found", async () => {
    const workspace = await dispatchOk<{ workspaceId: string }>("workspaces", "create", { name: "Acme" })
    const client = await connectClient()

    const created = await client.callTool({
      name: "workflows_create",
      arguments: { workspaceId: workspace.workspaceId, ...brokenGraph },
    })
    const body = JSON.parse(textOf(created as { content: Array<{ type: string; text?: string }> })) as {
      result: { workflowId: string }
      diagnosis: { summary: { errors: number }; diagnostics: Array<{ code: string }> }
    }

    const codes = body.diagnosis.diagnostics.map((diagnostic) => diagnostic.code)
    expect(codes).toContain("assertion_branch_handle_invalid")
    expect(codes).toContain("assertion_source_path_invalid")
    expect(body.diagnosis.summary.errors).toBeGreaterThan(0)
    // The write still succeeded — the diagnosis reports, it does not reject.
    expect(body.result.workflowId).toBeTruthy()
    await client.close()
  })

  it("reports a clean graph with no errors", async () => {
    const workspace = await dispatchOk<{ workspaceId: string }>("workspaces", "create", { name: "Acme" })
    const client = await connectClient()
    const created = await client.callTool({
      name: "workflows_create",
      arguments: {
        workspaceId: workspace.workspaceId,
        name: "clean",
        nodes: [
          { nodeId: "start", type: "start", position: { x: 0, y: 0 } },
          { nodeId: "request", type: "http-request", position: { x: 100, y: 0 }, config: {} },
          {
            nodeId: "assert",
            type: "assertion",
            position: { x: 200, y: 0 },
            config: { assertions: [{ source: "prev", path: "response.body.id", operator: "exists" }] },
          },
          { nodeId: "cleanup", type: "http-request", position: { x: 300, y: 100 }, config: {} },
          // One end node: the analyzer reports a second as `duplicate_end_node`,
          // so both branches converge rather than each getting their own.
          { nodeId: "done", type: "end", position: { x: 400, y: 0 } },
        ],
        edges: [
          { edgeId: "e1", source: "start", target: "request" },
          { edgeId: "e2", source: "request", target: "assert" },
          { edgeId: "e3", source: "assert", target: "done", sourceHandle: "pass" },
          { edgeId: "e4", source: "assert", target: "cleanup", sourceHandle: "fail" },
          { edgeId: "e5", source: "cleanup", target: "done" },
        ],
      },
    })
    const body = JSON.parse(textOf(created as { content: Array<{ type: string; text?: string }> })) as {
      diagnosis: { summary: { errors: number } }
    }
    expect(body.diagnosis.summary.errors).toBe(0)
    await client.close()
  })

  it("fixes an edge handle through workflows_patch without resending the graph", async () => {
    const workspace = await dispatchOk<{ workspaceId: string }>("workspaces", "create", { name: "Acme" })
    const client = await connectClient()
    const created = JSON.parse(
      textOf(
        (await client.callTool({
          name: "workflows_create",
          arguments: { workspaceId: workspace.workspaceId, ...brokenGraph },
        })) as { content: Array<{ type: string; text?: string }> },
      ),
    ) as { result: { workflowId: string; rev: number } }

    const patched = await client.callTool({
      name: "workflows_patch",
      arguments: {
        workspaceId: workspace.workspaceId,
        workflowId: created.result.workflowId,
        expectedRevision: created.result.rev,
        return: "full",
        // Only the two broken pieces travel — not the four nodes and three edges.
        upsertEdges: [{ edgeId: "e3", source: "assert", target: "end", sourceHandle: "pass" }],
        upsertNodes: [
          {
            nodeId: "assert",
            type: "assertion",
            position: { x: 200, y: 0 },
            config: { assertions: [{ source: "prev", path: "response.body.id", operator: "exists" }] },
          },
        ],
      },
    })
    const body = JSON.parse(textOf(patched as { content: Array<{ type: string; text?: string }> })) as {
      result: { nodes: Array<{ nodeId: string }>; edges: Array<{ edgeId: string; sourceHandle?: string | null }> }
      diagnosis: { diagnostics: Array<{ code: string }> }
    }

    expect(body.result.nodes.map((node) => node.nodeId)).toEqual(["start", "request", "assert", "end"])
    expect(body.result.edges.find((edge) => edge.edgeId === "e3")?.sourceHandle).toBe("pass")
    const codes = body.diagnosis.diagnostics.map((diagnostic) => diagnostic.code)
    expect(codes).not.toContain("assertion_branch_handle_invalid")
    expect(codes).not.toContain("assertion_source_path_invalid")
    await client.close()
  })

  it("rejects a patch computed against a stale revision instead of clobbering", async () => {
    const workspace = await dispatchOk<{ workspaceId: string }>("workspaces", "create", { name: "Acme" })
    const workflow = await dispatchOk<{ workflowId: string; rev: number }>("workflows", "create", {
      workspaceId: workspace.workspaceId,
      name: "concurrent",
    })
    await dispatchOk("workflows", "update", {
      workspaceId: workspace.workspaceId,
      workflowId: workflow.workflowId,
      name: "edited elsewhere",
    })

    const client = await connectClient()
    const stale = await client.callTool({
      name: "workflows_patch",
      arguments: {
        workspaceId: workspace.workspaceId,
        workflowId: workflow.workflowId,
        expectedRevision: workflow.rev,
        setVariables: { petId: "1" },
      },
    })
    expect((stale as { isError?: boolean }).isError).toBe(true)
    expect(textOf(stale as { content: Array<{ type: string; text?: string }> })).toContain("conflict")
    await client.close()
  })

  it("drops the edges of a removed node and merges variables in place", async () => {
    const workspace = await dispatchOk<{ workspaceId: string }>("workspaces", "create", { name: "Acme" })
    const workflow = await dispatchOk<{ workflowId: string }>("workflows", "create", {
      workspaceId: workspace.workspaceId,
      name: "prunable",
      nodes: [
        { nodeId: "start", type: "start", position: { x: 0, y: 0 } },
        { nodeId: "doomed", type: "http-request", position: { x: 100, y: 0 }, config: {} },
        { nodeId: "end", type: "end", position: { x: 200, y: 0 } },
      ],
      edges: [
        { edgeId: "e1", source: "start", target: "doomed" },
        { edgeId: "e2", source: "doomed", target: "end" },
      ],
      variables: { keep: "yes", drop: "no" },
    })

    const client = await connectClient()
    const patched = JSON.parse(
      textOf(
        (await client.callTool({
          name: "workflows_patch",
          arguments: {
            workspaceId: workspace.workspaceId,
            workflowId: workflow.workflowId,
            return: "full",
            removeNodeIds: ["doomed"],
            upsertEdges: [{ edgeId: "e3", source: "start", target: "end" }],
            setVariables: { added: "1" },
            unsetVariables: ["drop"],
          },
        })) as { content: Array<{ type: string; text?: string }> },
      ),
    ) as { result: { nodes: Array<{ nodeId: string }>; edges: Array<{ edgeId: string }>; variables: Record<string, unknown> } }

    expect(patched.result.nodes.map((node) => node.nodeId)).toEqual(["start", "end"])
    expect(patched.result.edges.map((edge) => edge.edgeId)).toEqual(["e3"])
    expect(patched.result.variables).toEqual({ keep: "yes", added: "1" })
    await client.close()
  })

  it("workflows_patch defaults to a compact summary projection, not the full graph echo (item 7)", async () => {
    const workspace = await dispatchOk<{ workspaceId: string }>("workspaces", "create", { name: "Acme" })
    const created = await dispatchOk<{ workflowId: string; rev: number }>("workflows", "create", {
      workspaceId: workspace.workspaceId,
      name: "summary-default",
      nodes: [
        { nodeId: "start", type: "start", position: { x: 0, y: 0 } },
        {
          nodeId: "http",
          type: "http-request",
          position: { x: 100, y: 0 },
          config: { method: "GET", url: "https://example.test" },
        },
        {
          nodeId: "assert",
          type: "assertion",
          position: { x: 200, y: 0 },
          config: { assertions: [{ source: "status", path: "", operator: "equals", expectedValue: 200 }] },
        },
        { nodeId: "end", type: "end", position: { x: 300, y: 0 } },
      ],
      edges: [
        { edgeId: "e1", source: "start", target: "http" },
        { edgeId: "e2", source: "http", target: "assert" },
        { edgeId: "e3", source: "assert", target: "end", sourceHandle: "pass" },
      ],
    })

    const client = await connectClient()
    const patched = JSON.parse(
      textOf(
        (await client.callTool({
          name: "workflows_patch",
          arguments: {
            workspaceId: workspace.workspaceId,
            workflowId: created.workflowId,
            // Intentionally no `return`: the default for workflows_patch is "summary".
            setVariables: { marker: "x" },
          },
        })) as { content: Array<{ type: string; text?: string }> },
      ),
    ) as {
      result: {
        kind: string
        workflowId: string
        rev: number
        nodeCount: number
        edgeCount: number
        touchedNodeIds: string[]
        touchedEdgeIds: string[]
        diagnosis: { diagnostics: unknown[] }
      }
      diagnosis: { diagnostics: unknown[] }
    }

    // Default patches return a small summary projection — NOT the full node/edge echo.
    expect(patched.result.kind).toBe("summary")
    expect(patched.result.workflowId).toBe(created.workflowId)
    expect(patched.result.rev).toBe(created.rev + 1)
    expect(patched.result.nodeCount).toBe(4)
    expect(patched.result.edgeCount).toBe(3)
    // No nodes/edges were touched by this patch.
    expect(patched.result.touchedNodeIds).toEqual([])
    expect(patched.result.touchedEdgeIds).toEqual([])
    // Diagnosis always rides along, nested in result (the "summary" shape's own field, for
    // IPC/renderer callers)...
    expect(Array.isArray(patched.result.diagnosis.diagnostics)).toBe(true)
    // ...and — regression (item 7) — also at the top-level sibling every write tool's guide
    // says to read, the same place `return: "full"` puts it. It must not only live nested
    // for this shape while `"full"` only has it as a sibling.
    expect(patched.diagnosis).toEqual(patched.result.diagnosis)
    await client.close()
  })

  it("workflows_patch reports touched ids when nodes/edges are upserted or removed", async () => {
    const workspace = await dispatchOk<{ workspaceId: string }>("workspaces", "create", { name: "Acme" })
    const created = await dispatchOk<{ workflowId: string; rev: number }>("workflows", "create", {
      workspaceId: workspace.workspaceId,
      name: "touched",
      nodes: [
        { nodeId: "start", type: "start", position: { x: 0, y: 0 } },
        { nodeId: "doomed", type: "delay", position: { x: 100, y: 0 }, config: { duration: 1 } },
        { nodeId: "end", type: "end", position: { x: 300, y: 0 } },
      ],
      edges: [
        { edgeId: "e1", source: "start", target: "doomed" },
        { edgeId: "e2", source: "doomed", target: "end" },
      ],
    })

    const client = await connectClient()
    const patched = JSON.parse(
      textOf(
        (await client.callTool({
          name: "workflows_patch",
          arguments: {
            workspaceId: workspace.workspaceId,
            workflowId: created.workflowId,
            removeNodeIds: ["doomed"],
            upsertEdges: [{ edgeId: "e3", source: "start", target: "end" }],
          },
        })) as { content: Array<{ type: string; text?: string }> },
      ),
    ) as { result: { touchedNodeIds: string[]; touchedEdgeIds: string[] } }

    expect(patched.result.touchedNodeIds).toEqual(["doomed"])
    // e3 was upserted; e2 was implicitly dropped as the incoming/outgoing edge of the removed node, but is not named here.
    expect(patched.result.touchedEdgeIds).toEqual(["e3"])
    await client.close()
  })
})

describe("MCP reads — redacted values, intact structure", () => {
  const httpNode = {
    nodeId: "request",
    type: "http-request",
    position: { x: 0, y: 0 },
    config: {
      method: "POST",
      url: "https://api.example.com/pets",
      headers: [
        { key: "Authorization", value: "Bearer literal-credential" },
        { key: "X-Tenant", value: "acme" },
        { key: "X-Api-Key", value: "{{secrets.API_KEY}}" },
      ],
      body: '{"name":"Rex","password":"hunter2"}',
      bodyType: "json",
    },
  }

  async function readBackConfig(): Promise<Record<string, unknown>> {
    const workspace = await dispatchOk<{ workspaceId: string }>("workspaces", "create", { name: "Acme" })
    const workflow = await dispatchOk<{ workflowId: string }>("workflows", "create", {
      workspaceId: workspace.workspaceId,
      name: "redaction",
      nodes: [httpNode],
    })
    const client = await connectClient()
    const read = JSON.parse(
      textOf(
        (await client.callTool({
          name: "workflows_get",
          arguments: { workspaceId: workspace.workspaceId, workflowId: workflow.workflowId },
        })) as { content: Array<{ type: string; text?: string }> },
      ),
    ) as { nodes: Array<{ nodeId: string; config: Record<string, unknown> }> }
    await client.close()
    return read.nodes[0]!.config
  }

  it("keeps a secret-named header as an entry with a withheld value, instead of dropping it", async () => {
    const config = await readBackConfig()
    const headers = config["headers"] as Array<{ key: string; value: string }>

    // Dropping the entry made a read useless as a write confirmation: the agent
    // could not tell a stored-but-withheld header from one that never saved.
    expect(headers.map((header) => header.key)).toEqual(["Authorization", "X-Tenant", "X-Api-Key"])
    expect(headers[0]?.value).toBe("<SECRET>")
    expect(headers[1]?.value).toBe("acme")
    // A reference is an indirection, not a secret — it survives so the agent can
    // see which credential the request binds to.
    expect(headers[2]?.value).toBe("{{secrets.API_KEY}}")
  })

  it("redacts a body leaf by leaf rather than flattening the whole body", async () => {
    const config = await readBackConfig()
    const body = JSON.parse(config["body"] as string) as Record<string, unknown>

    expect(body["name"]).toBe("Rex")
    expect(body["password"]).toBe("<SECRET>")
  })

  it("returns a body with nothing to redact byte-for-byte, so a read is a usable diff", async () => {
    const workspace = await dispatchOk<{ workspaceId: string }>("workspaces", "create", { name: "Acme" })
    const body = '{"name":"Rex","tag":"{{variables.tag}}"}'
    const workflow = await dispatchOk<{ workflowId: string }>("workflows", "create", {
      workspaceId: workspace.workspaceId,
      name: "plain body",
      nodes: [{ ...httpNode, config: { method: "POST", body, bodyType: "json" } }],
    })
    const client = await connectClient()
    const read = JSON.parse(
      textOf(
        (await client.callTool({
          name: "workflows_get",
          arguments: { workspaceId: workspace.workspaceId, workflowId: workflow.workflowId },
        })) as { content: Array<{ type: string; text?: string }> },
      ),
    ) as { nodes: Array<{ config: Record<string, unknown> }> }
    expect(read.nodes[0]?.config["body"]).toBe(body)
    await client.close()
  })

  it("still lets no credential value cross the bridge", async () => {
    const config = await readBackConfig()
    expect(JSON.stringify(config)).not.toContain("literal-credential")
    expect(JSON.stringify(config)).not.toContain("hunter2")
  })

  it("round-trips placeholder-valued auth, body and extractors byte-for-byte", async () => {
    const workspace = await dispatchOk<{ workspaceId: string }>("workspaces", "create", { name: "Acme" })
    const node = {
      nodeId: "login",
      type: "http-request",
      position: { x: 0, y: 0 },
      config: {
        method: "POST",
        url: "https://example.test/login",
        headers: [{ key: "Authorization", value: "Bearer {{variables.token}}" }],
        auth: { type: "bearer", bearer: { token: "{{variables.token}}" } },
        body: '{\n  "email": "{{env.EMAIL}}",\n  "password": "{{env.PASSWORD}}",\n  "application": "BO"\n}',
        bodyType: "json",
        extractors: { token: "response.body.data.access_token" },
      },
    }
    const workflow = await dispatchOk<{ workflowId: string }>("workflows", "create", {
      workspaceId: workspace.workspaceId,
      name: "round trip",
      nodes: [node],
    })
    const client = await connectClient()
    const getConfig = async (): Promise<Record<string, unknown>> => {
      const read = JSON.parse(
        textOf(
          (await client.callTool({
            name: "workflows_get",
            arguments: { workspaceId: workspace.workspaceId, workflowId: workflow.workflowId },
          })) as { content: Array<{ type: string; text?: string }> },
        ),
      ) as { nodes: Array<{ nodeId: string; config: Record<string, unknown> }> }
      return read.nodes[0]!.config
    }

    // The read must show every reference verbatim, or the author cannot tell a
    // wired slot from a redacted literal — the whole point of item 6.
    expect(await getConfig()).toEqual(node.config)

    // Read-modify-write: writing the graph back unchanged must neither be
    // rejected (no <SECRET> placeholder smuggled in) nor alter the stored graph.
    const updated = (await client.callTool({
      name: "workflows_update",
      arguments: {
        workspaceId: workspace.workspaceId,
        workflowId: workflow.workflowId,
        nodes: (JSON.parse(
          textOf(
            (await client.callTool({
              name: "workflows_get",
              arguments: { workspaceId: workspace.workspaceId, workflowId: workflow.workflowId },
            })) as { content: Array<{ type: string; text?: string }> },
          ),
        ) as { nodes: Array<unknown> }).nodes,
      },
    })) as { isError?: boolean; content: Array<{ type: string; text?: string }> }
    expect(updated.isError).toBeUndefined()

    expect(await getConfig()).toEqual(node.config)
    await client.close()
  })

  it("refuses to store a value read back as <SECRET>, naming where it is", async () => {
    const workspace = await dispatchOk<{ workspaceId: string }>("workspaces", "create", { name: "Acme" })
    const client = await connectClient()
    const rejected = (await client.callTool({
      name: "workflows_create",
      arguments: {
        workspaceId: workspace.workspaceId,
        name: "round trip",
        nodes: [
          {
            ...httpNode,
            config: { method: "POST", headers: [{ key: "Authorization", value: "<SECRET>" }] },
          },
        ],
      },
    })) as { isError?: boolean; content: Array<{ type: string; text?: string }> }

    // Without this the placeholder persists and the next run sends the literal
    // string `<SECRET>` upstream as the credential.
    expect(rejected.isError).toBe(true)
    const message = textOf(rejected)
    expect(message).toContain("<SECRET>")
    expect(message).toContain("{{secrets.NAME}}")
    await client.close()
  })

  it("leaves the unredacted renderer path free to store <SECRET>, so an imported bundle stays editable", async () => {
    const workspace = await dispatchOk<{ workspaceId: string }>("workspaces", "create", { name: "Acme" })
    // Export flattens a body to the placeholder, so a workflow imported from a
    // bundle legitimately holds one. The renderer autosaves the whole graph on
    // every edit; rejecting it there would make that workflow uneditable.
    const workflow = await dispatchOk<{ workflowId: string }>("workflows", "create", {
      workspaceId: workspace.workspaceId,
      name: "imported",
      nodes: [{ ...httpNode, config: { method: "POST", body: "<SECRET>" } }],
    })
    await expect(
      dispatchOk("workflows", "update", {
        workspaceId: workspace.workspaceId,
        workflowId: workflow.workflowId,
        name: "imported, renamed",
      }),
    ).resolves.toBeTruthy()
  })
})

describe("MCP assertions — one path rule, agreed on by validate and diagnose", () => {
  async function fixture(): Promise<{ workspaceId: string; workflowId: string }> {
    const workspace = await dispatchOk<{ workspaceId: string }>("workspaces", "create", { name: "Acme" })
    const workflow = await dispatchOk<{ workflowId: string }>("workflows", "create", {
      workspaceId: workspace.workspaceId,
      name: "paths",
      nodes: [
        { nodeId: "start", type: "start", position: { x: 0, y: 0 } },
        { nodeId: "request", type: "http-request", position: { x: 100, y: 0 }, config: {} },
        { nodeId: "assert", type: "assertion", position: { x: 200, y: 0 }, config: { assertions: [] } },
      ],
      edges: [
        { edgeId: "e1", source: "start", target: "request" },
        { edgeId: "e2", source: "request", target: "assert" },
      ],
    })
    return { workspaceId: workspace.workspaceId, workflowId: workflow.workflowId }
  }

  it("canonicalizes a bare response path instead of rejecting it", async () => {
    const { workspaceId, workflowId } = await fixture()
    const validated = await dispatchOk<{ valid: boolean; rules: Array<{ path: string }> }>(
      "assertions",
      "validate",
      {
        workspaceId,
        workflowId,
        sourceNodeId: "request",
        rules: [
          { source: "prev", path: "body.id", operator: "exists" },
          { source: "prev", path: "statusCode", operator: "equals", expectedValue: 200 },
        ],
      },
    )
    expect(validated.valid).toBe(true)
    expect(validated.rules.map((rule) => rule.path)).toEqual(["response.body.id", "response.statusCode"])
  })

  it("explains what a valid path looks like when one cannot address a value", async () => {
    const { workspaceId, workflowId } = await fixture()
    const validated = await dispatchOk<{ valid: boolean; issues: Array<{ code: string; message: string }> }>(
      "assertions",
      "validate",
      {
        workspaceId,
        workflowId,
        sourceNodeId: "request",
        rules: [{ source: "prev", path: "id", operator: "exists" }],
      },
    )
    expect(validated.valid).toBe(false)
    const issue = validated.issues.find((candidate) => candidate.code === "invalid_path")
    expect(issue?.message).toContain("response.body.id")
  })

  it("accepts through validate exactly what diagnose accepts (no path that passes one and trips the other)", async () => {
    const { workspaceId, workflowId } = await fixture()
    const rules = [
      { source: "prev", path: "response.headers.content-type", operator: "exists" },
      { source: "prev", path: "response.duration", operator: "lte", expectedValue: 500 },
      { source: "headers", path: "content-type", operator: "exists" },
    ]
    const validated = await dispatchOk<{ valid: boolean; rules: unknown[] }>("assertions", "validate", {
      workspaceId,
      workflowId,
      sourceNodeId: "request",
      rules,
    })
    expect(validated.valid).toBe(true)

    await dispatchOk("workflows", "update", {
      workspaceId,
      workflowId,
      nodes: [
        { nodeId: "start", type: "start", position: { x: 0, y: 0 } },
        { nodeId: "request", type: "http-request", position: { x: 100, y: 0 }, config: {} },
        {
          nodeId: "assert",
          type: "assertion",
          position: { x: 200, y: 0 },
          config: { assertions: validated.rules },
        },
      ],
      edges: [
        { edgeId: "e1", source: "start", target: "request" },
        { edgeId: "e2", source: "request", target: "assert" },
      ],
    })
    const diagnosis = await dispatchOk<{ diagnostics: Array<{ code: string }> }>("workflows", "diagnose", {
      workspaceId,
      workflowId,
    })
    expect(diagnosis.diagnostics.map((diagnostic) => diagnostic.code)).not.toContain("assertion_source_path_invalid")
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

describe("MCP bridge — reuse primitives reach agents (presets, sub-workflows, inheritance)", () => {
  it("whitelists the nodePresets domain with the right intents and annotations", () => {
    const byName = new Map(MCP_TOOLS.map((spec) => [toolName(spec), spec]))
    expect(byName.get("nodePresets_list")).toMatchObject({
      domain: "nodePresets",
      action: "list",
      intent: "read",
    })
    expect(byName.get("nodePresets_create")).toMatchObject({ intent: "write" })
    expect(byName.get("nodePresets_update")).toMatchObject({ intent: "write", idempotent: true })
    expect(byName.get("nodePresets_delete")).toMatchObject({ intent: "write", destructive: true })
  })

  it("nodePresets_list returns the same body as the IPC dispatch it wraps", async () => {
    const workspace = await dispatchOk<{ workspaceId: string }>("workspaces", "create", { name: "Acme" })
    const created = await dispatchOk<{ presetId: string }>("nodePresets", "create", {
      workspaceId: workspace.workspaceId,
      name: "Standard auth headers",
      nodeType: "http-request",
      config: { method: "GET", url: "https://api.example.test/ping" },
    })

    const client = await connectClient()
    const result = await client.callTool({
      name: "nodePresets_list",
      arguments: { workspaceId: workspace.workspaceId },
    })
    const viaTool = JSON.parse(textOf(result as { content: Array<{ type: string; text?: string }> }))
    const viaIpc = await dispatchOk("nodePresets", "list", { workspaceId: workspace.workspaceId })

    expect(viaTool).toEqual(viaIpc)
    expect(viaTool.items.map((p: { presetId: string }) => p.presetId)).toContain(created.presetId)
    await client.close()
  })

  it("redacts a preset's URL, body and header values on the way out, like any other MCP read", async () => {
    const LEAK = "opaque-header-value-that-must-not-cross-mcp"
    const workspace = await dispatchOk<{ workspaceId: string }>("workspaces", "create", { name: "Acme" })
    await dispatchOk("nodePresets", "create", {
      workspaceId: workspace.workspaceId,
      name: "Promoted from a real request",
      nodeType: "http-request",
      config: {
        method: "POST",
        url: `https://api.example.test/login?token=${LEAK}`,
        headers: [{ key: "Authorization", value: `Bearer ${LEAK}` }],
        body: `{"password":"${LEAK}"}`,
      },
    })

    const client = await connectClient()
    const text = textOf(
      (await client.callTool({
        name: "nodePresets_list",
        arguments: { workspaceId: workspace.workspaceId },
      })) as { content: Array<{ type: string; text?: string }> },
    )

    expect(text).not.toContain(LEAK)
    // The catalogue itself still reaches the agent — only the values are gone.
    expect(text).toContain("Promoted from a real request")
    await client.close()
  })

  it("environments_create accepts a base environment and the read reports the link", async () => {
    const workspace = await dispatchOk<{ workspaceId: string }>("workspaces", "create", { name: "Acme" })
    const base = await dispatchOk<{ environmentId: string }>("environments", "create", {
      workspaceId: workspace.workspaceId,
      name: "base",
      variables: { HOST: "api.base.test" },
    })

    const client = await connectClient()
    const created = JSON.parse(
      textOf(
        (await client.callTool({
          name: "environments_create",
          arguments: {
            workspaceId: workspace.workspaceId,
            name: "staging",
            baseEnvironmentId: base.environmentId,
          },
        })) as { content: Array<{ type: string; text?: string }> },
      ),
    )

    expect(created.baseEnvironmentId).toBe(base.environmentId)
    const read = JSON.parse(
      textOf(
        (await client.callTool({
          name: "environments_get",
          arguments: { workspaceId: workspace.workspaceId, environmentId: created.environmentId },
        })) as { content: Array<{ type: string; text?: string }> },
      ),
    )
    expect(read.baseEnvironmentId).toBe(base.environmentId)
    await client.close()
  })

  // Cross-workspace target rejection is covered in services.test.ts, which can
  // seed two real workspaces; this harness resolves a single local workspace.
  it("workflows_create accepts a Call Workflow node and workflows_update refuses a self-call", async () => {
    const workspace = await dispatchOk<{ workspaceId: string }>("workspaces", "create", { name: "Acme" })
    const target = await dispatchOk<{ workflowId: string }>("workflows", "create", {
      workspaceId: workspace.workspaceId,
      name: "Authenticate",
    })

    const client = await connectClient()
    const nodesFor = (targetWorkflowId: string) => [
      { nodeId: "start", type: "start", position: { x: 0, y: 0 } },
      {
        nodeId: "call1",
        type: "workflow",
        position: { x: 120, y: 0 },
        config: {
          targetWorkflowId,
          inputMapping: { tenant: "{{variables.tenantId}}" },
          // `cartId` reads back literally; `token` is a secret-looking KEY, so
          // the bridge's blanket redaction rewrites its value on the way out.
          outputMapping: { cartId: "cartId", token: "accessToken" },
        },
      },
    ]

    // A graph write answers `{ result, diagnosis }` — see the fail-fast suite.
    const { result: created } = JSON.parse(
      textOf(
        (await client.callTool({
          name: "workflows_create",
          arguments: {
            workspaceId: workspace.workspaceId,
            name: "caller",
            nodes: nodesFor(target.workflowId),
          },
        })) as { content: Array<{ type: string; text?: string }> },
      ),
    )
    const callNode = created.nodes.find((n: { nodeId: string }) => n.nodeId === "call1")
    expect(callNode.config.targetWorkflowId).toBe(target.workflowId)
    expect(callNode.config.inputMapping).toEqual({ tenant: "{{variables.tenantId}}" })
    expect(callNode.config.outputMapping).toEqual({ cartId: "cartId", token: "<SECRET>" })

    // Redaction is a read-time projection for the less-trusted MCP caller: the
    // stored mapping is intact, as the renderer's own (unredacted) read shows.
    const viaIpc = await dispatchOk<{ nodes: Array<{ nodeId: string; config?: Record<string, unknown> }> }>(
      "workflows",
      "get",
      { workspaceId: workspace.workspaceId, workflowId: created.workflowId },
    )
    expect(viaIpc.nodes.find((n) => n.nodeId === "call1")?.config?.["outputMapping"]).toEqual({
      cartId: "cartId",
      token: "accessToken",
    })

    const rejected = (await client.callTool({
      name: "workflows_update",
      arguments: {
        workspaceId: workspace.workspaceId,
        workflowId: created.workflowId,
        nodes: nodesFor(created.workflowId),
      },
    })) as { isError?: boolean; content: Array<{ type: string; text?: string }> }
    expect(rejected.isError).toBe(true)
    expect(textOf(rejected)).toContain("cannot call its own workflow")
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

    // The notification rides the GET SSE stream — allow it to arrive. The budget
    // is generous because the loop exits on arrival: it bounds a hang, it does
    // not assert a latency, and a tight bound only makes the suite flaky as more
    // tests share the machine.
    for (let i = 0; i < 250 && notified.length < 1; i++) {
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    expect(notified).toContain(uri)

    const read = await client.readResource({ uri })
    const snapshot = JSON.parse((read.contents[0] as { text: string }).text) as { latestSequence: number }
    expect(snapshot.latestSequence).toBe(broker.getLatestSequence(runId))
  }, POLL_TEST_TIMEOUT_MS)

  it("removes a session on DELETE (terminateSession) with no leaked listener", async () => {
    host = new McpHost({ router, tokenFilePath: tokenPath, version: "test", preferredPort: 0, broker })
    const { token, port } = await host.start()
    const { workspaceId, runId } = await seedRun()

    const client = await connectHttp(port, token)
    await client.subscribeResource({ uri: `apiweave://workspaces/${workspaceId}/runs/${runId}` })
    expect(host.getSessionCount()).toBe(1)

    await (client.transport as StreamableHTTPClientTransport).terminateSession()
    for (let i = 0; i < 250 && host.getSessionCount() > 0; i++) {
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    expect(host.getSessionCount()).toBe(0)
    // Broker fan-out stays clean after the subscribing session is gone (its
    // resource-subscription listener was detached on session close).
    expect(() => broker.publish(runId, { kind: "run.finished", runId, status: "completed" })).not.toThrow()
  }, POLL_TEST_TIMEOUT_MS)

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

    for (let i = 0; i < 250 && host.getSessionCount() > 0; i++) {
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    expect(host.getSessionCount()).toBe(0)
  }, POLL_TEST_TIMEOUT_MS)

  it("rejects a new session past the max-sessions limit", async () => {
    host = new McpHost({ router, tokenFilePath: tokenPath, version: "test", preferredPort: 0, broker, maxSessions: 1 })
    const { token, port } = await host.start()

    await connectHttp(port, token)
    expect(host.getSessionCount()).toBe(1)
    await expect(connectHttp(port, token)).rejects.toThrow()
  })
})
