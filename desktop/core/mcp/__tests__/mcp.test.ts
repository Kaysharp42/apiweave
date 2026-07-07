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
import { EnvironmentService } from "../../services/environment_service"
import { RunService } from "../../services/run_service"
import { SecretService, type SecretWriteStore, type SecretUpsert } from "../../services/secret_service"
import { ProjectExportService } from "../../services/project_export_service"
import type { SecretMetadata, SecretScopeType } from "../../secrets/scoped_secret_resolver"
import { IpcRouter } from "../../ipc/router"
import { registerAllHandlers, type HandlerDeps } from "../../ipc/handlers"
import { MCP_TOOLS } from "../tools"
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

beforeEach(() => {
  db = initDatabase({ databasePath: ":memory:" })
  const workspaces = new WorkspaceRepository(db.kvStore)
  const workflows = new WorkflowRepository(db.kvStore)
  const runs = new RunRepository(db.kvStore)
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
  const deps: HandlerDeps = {
    workspaces: new WorkspaceService(workspaces, sync, scopeResolver),
    collections: new CollectionService(collections, workflows, sync, permissions, scopeResolver),
    workflows: new WorkflowService(workflows, sync, permissions, scopeResolver, collections, environments),
    environments: new EnvironmentService(environments, sync, permissions, scopeResolver),
    runs: new RunService(runs, sync, permissions, scopeResolver),
    secrets: new SecretService(secretStore, sync, permissions, scopeResolver),
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
    }
  })
})

describe("MCP bridge — second transport, parity by construction", () => {
  it("tools/list is non-empty, includes server_info + workflows_list, excludes secrets_set", async () => {
    const client = await connectClient()
    const { tools } = await client.listTools()
    const names = tools.map((t) => t.name)
    expect(names).toContain("workflows_list")
    expect(names).toContain("server_info")
    expect(names).not.toContain("secrets_set")
    expect(names).not.toContain("runs_openArtifact")
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
    expect(viaTool.items.map((w: { workflowId: string }) => w.workflowId)).toContain(created.workflowId)
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

  async function post(port: number, headers: Record<string, string>, body: unknown): Promise<{ status: number; text: string }> {
    const payload = JSON.stringify(body)
    return await new Promise((resolve, reject) => {
      const req = http.request(
        {
          host: "127.0.0.1",
          port,
          path: "/mcp",
          method: "POST",
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
})
