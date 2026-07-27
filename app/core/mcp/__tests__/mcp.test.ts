import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { rmSync, readFileSync } from "node:fs"
import http from "node:http"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
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

function textOf(result: { content: Array<{ type: string; text?: string }> }): string {
  return result.content.map((c) => c.text ?? "").join("")
}

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
    expect((await request(port, "GET", "/mcp", { authorization }, undefined)).status).toBe(405)
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
