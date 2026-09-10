import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
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
import type { SecretMetadata } from "../../secrets/scoped_secret_resolver"
import type { WorkflowDebugContext } from "@shared/types/WorkflowDebugContext"
import { IpcRouter } from "../../ipc/router"
import { registerAllHandlers, type HandlerDeps } from "../../ipc/handlers"
import { MCP_TOOLS, toolName } from "../tools"
import { createMcpServer } from "../server"

/**
 * Phase 3 (one-call debug context) exit conditions:
 * - A known-workflow failure is explainable in one bounded context read, with
 *   provenance and the inputs needed for a patch.
 * - Run selection is explicit (explicit runId, otherwise latest failed).
 * - Current workflow rev travels separately from the run rev; historical graph
 *   correlation is unknown, never assumed.
 * - Aggregate budget holds with explicit omissions and continuation args.
 * - Redaction, strict schemas, revision safety and the explicit whitelist hold;
 *   empty/denied/stale cases are explicit, not errors or silent slices.
 */
class FakeSecretStore implements SecretWriteStore {
  put(input: SecretUpsert): SecretMetadata {
    return {
      secretId: `${input.scopeType}/${input.scopeId}/${input.name}`,
      name: input.name,
      scopeType: input.scopeType,
      scopeId: input.scopeId,
      keyId: input.keyId,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    }
  }
  remove(): boolean {
    return false
  }
  listByScope(): SecretMetadata[] {
    return []
  }
  getByScopeAndName(): SecretMetadata | null {
    return null
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
    workspaces: new WorkspaceService(workspaces, workflows, sync, scopeResolver),
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

async function dispatchErr(domain: string, action: string, payload?: unknown): Promise<{ code: string; message: string }> {
  const res = await router.dispatch({ domain, action, payload })
  if (res.ok) throw new Error(`expected error, got ${JSON.stringify(res.data)}`)
  return { code: res.error.code, message: res.error.message }
}

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

async function seedWorkspace(name = "Acme"): Promise<string> {
  const workspace = await dispatchOk<{ workspaceId: string }>("workspaces", "create", { name, isPersonal: false })
  return workspace.workspaceId
}

/** Space two run creations across a millisecond boundary so latest-wins is deterministic. */
async function tickMs(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 5))
}

interface SeededFailure {
  workspaceId: string
  workflowId: string
  workflowRev: number
  runId: string
  environmentId: string
}

async function seedFailure(): Promise<SeededFailure> {
  const workspaceId = await seedWorkspace()
  const base = await dispatchOk<{ environmentId: string }>("environments", "create", {
    workspaceId,
    name: "base",
    variables: { BASE_URL: "https://example.test", SHARED: "from-base" },
  })
  const child = await dispatchOk<{ environmentId: string }>("environments", "create", {
    workspaceId,
    name: "child",
    baseEnvironmentId: base.environmentId,
    variables: { API_TOKEN: "plain-env-value", SHARED: "from-child" },
  })
  const workflow = await dispatchOk<{ workflowId: string; rev: number }>("workflows", "create", {
    workspaceId,
    name: "orders",
    selectedEnvironmentId: child.environmentId,
    nodes: [
      { nodeId: "start", type: "start", position: { x: 0, y: 0 } },
      {
        nodeId: "login",
        type: "http-request",
        position: { x: 100, y: 0 },
        config: {
          method: "POST",
          url: "{{env.BASE_URL}}/login?next={{env.MISSING_KEY}}",
          headers: [{ key: "Authorization", value: "Bearer {{secrets.API_TOKEN}}" }],
        },
      },
      {
        nodeId: "check",
        type: "assertion",
        position: { x: 200, y: 0 },
        config: { assertions: [{ source: "prev", path: "response.body.ok", operator: "equals", expectedValue: true }] },
      },
      { nodeId: "end", type: "end", position: { x: 300, y: 0 } },
    ],
    edges: [
      { edgeId: "e1", source: "start", target: "login" },
      { edgeId: "e2", source: "login", target: "check", sourceHandle: "pass" },
      { edgeId: "e3", source: "check", target: "end", sourceHandle: "pass" },
    ],
  })
  const run = runRepository.create({ workspaceId, workflowId: workflow.workflowId })
  runRepository.update(run.runId, {
    status: "failed",
    selectedEnvironmentId: child.environmentId,
    results: [
      {
        nodeId: "login",
        status: "failed",
        duration: 12,
        request: { method: "POST", url: "https://example.test/login" },
        response: { statusCode: 401, body: { error: "BAD_CREDENTIALS" } },
        error: "Request failed with status 401",
        expectedStatus: 200,
        secretRefs: ["API_TOKEN"],
        unresolvedPlaceholders: ["env.MISSING_KEY"],
      },
      { nodeId: "check", status: "skipped", duration: 0 },
    ],
    failedNodes: ["login"],
    resolvedSecrets: [{ name: "API_TOKEN", scopeType: "workspace", resolved: true }],
  })
  return { workspaceId, workflowId: workflow.workflowId, workflowRev: workflow.rev, runId: run.runId, environmentId: child.environmentId }
}

async function debugContext(args: Record<string, unknown>): Promise<WorkflowDebugContext> {
  return dispatchOk<WorkflowDebugContext>("workflows", "debugContext", args)
}

describe("Phase 3 — one call explains a known failure", () => {
  it("returns identity, run, failures, configs, edges, diagnosis and evidence together", async () => {
    const seed = await seedFailure()
    const context = await debugContext({ workspaceId: seed.workspaceId, workflowId: seed.workflowId })

    expect(context.workflow).toMatchObject({ workflowId: seed.workflowId, workspaceId: seed.workspaceId, rev: seed.workflowRev })
    expect(context.runSelection).toEqual({ policy: "latest-failed", runId: seed.runId })
    expect(context.run).toMatchObject({ runId: seed.runId, workflowId: seed.workflowId, status: "failed" })
    expect(typeof context.run?.runRev).toBe("number")
    expect(context.graphCorrelation.status).toBe("unknown")

    expect(context.failureSummary.failedNodeIds).toEqual(["login"])
    expect(context.failureSummary.failedNodeCount).toBe(1)
    // check never ran: its skipped result is blocked. `end` is not — the
    // executor never persists a row for one, so its absence proves nothing.
    expect(context.failureSummary.blockedNodeIds).toEqual(["check"])
    expect(context.failureSummary.blockedNodeCount).toBe(context.failureSummary.blockedNodeIds.length)

    // Failed config plus nearest dependency (start) travel with handles intact.
    expect(context.nodes.map((node) => node.nodeId)).toContain("login")
    const login = context.nodes.find((node) => node.nodeId === "login")
    expect(login?.type).toBe("http-request")
    expect(context.edges.map((edge) => edge.edgeId)).toEqual(expect.arrayContaining(["e1", "e2"]))
    expect(context.edges.find((edge) => edge.edgeId === "e2")).toMatchObject({ sourceHandle: "pass" })

    expect(context.diagnosis.status).toBe("complete")
    if (context.diagnosis.status === "complete") {
      expect(context.diagnosis.summary.errors).toBeGreaterThan(0)
      expect(context.diagnosis.items.map((item) => item.code)).toContain("http_request_failed")
      expect(context.diagnosis.omittedItemCount).toBe(0)
    }

    const evidence = context.evidence.find((item) => item.nodeId === "login")
    expect(evidence).toMatchObject({
      status: "failed",
      hasError: true,
      errorPreview: "Request failed with status 401",
      errorTruncated: false,
      expectedStatus: 200,
      responseStatusCode: 401,
      unresolvedPlaceholders: ["env.MISSING_KEY"],
    })
    expect(evidence?.moreDetail).toMatchObject({
      tool: "runs_getNodeResult",
      args: { workspaceId: seed.workspaceId, runId: seed.runId, nodeIds: ["login"] },
    })

    expect(context.placeholders).toMatchObject({ unresolved: ["env.MISSING_KEY"], unresolvedCount: 1 })

    expect(context.budgetBytes).toBeLessThanOrEqual(context.budgetLimitBytes)
    expect(context.budgetLimitBytes).toBe(32 * 1024)
    expect(context.omittedNodeIds).toEqual([])
  })

  it("reports environment key presence with base-chain provenance, never values", async () => {
    const seed = await seedFailure()
    const context = await debugContext({ workspaceId: seed.workspaceId, workflowId: seed.workflowId })

    expect(context.environment.workflowSelectedEnvironmentId).toBe(seed.environmentId)
    expect(context.environment.runSelectedEnvironmentId).toBe(seed.environmentId)
    expect(context.environment.evaluatedEnvironmentId).toBe(seed.environmentId)
    const byName = new Map(context.environment.keys.map((key) => [key.name, key]))
    // BASE_URL lives on the base environment; SHARED is overridden by the child.
    expect(byName.get("BASE_URL")).toMatchObject({ present: true, sourceEnvironmentName: "base" })
    expect(byName.get("MISSING_KEY")).toMatchObject({ present: false, sourceEnvironmentId: null })
    expect(context.environment.totalKeyCount).toBe(context.environment.keys.length)
    const serialized = JSON.stringify(context)
    expect(serialized).not.toContain("plain-env-value")
    expect(serialized).toContain("environments_get")
  })

  it("reports secret names with run-recorded resolution metadata, never values", async () => {
    const seed = await seedFailure()
    const context = await debugContext({ workspaceId: seed.workspaceId, workflowId: seed.workflowId })

    expect(context.secrets).toEqual([{ name: "API_TOKEN", resolved: true, scopeType: "workspace", fromRun: true }])
    expect(context.totalSecretCount).toBe(1)
  })

  it("honours an explicit runId and names the policy", async () => {
    const seed = await seedFailure()
    const completed = runRepository.create({ workspaceId: seed.workspaceId, workflowId: seed.workflowId })
    runRepository.update(completed.runId, { status: "completed", results: [] })

    const context = await debugContext({
      workspaceId: seed.workspaceId,
      workflowId: seed.workflowId,
      runId: completed.runId,
    })
    expect(context.runSelection).toEqual({ policy: "explicit", runId: completed.runId })
    expect(context.run?.status).toBe("completed")
    expect(context.failureSummary.failedNodeCount).toBe(0)
  })

  it("latest-failed skips newer non-failed runs and picks the newest failure", async () => {
    const seed = await seedFailure()
    await tickMs()
    const newer = runRepository.create({ workspaceId: seed.workspaceId, workflowId: seed.workflowId })
    runRepository.update(newer.runId, { status: "failed", results: [], failedNodes: [] })
    await tickMs()
    const completed = runRepository.create({ workspaceId: seed.workspaceId, workflowId: seed.workflowId })
    runRepository.update(completed.runId, { status: "completed", results: [] })

    const context = await debugContext({ workspaceId: seed.workspaceId, workflowId: seed.workflowId })
    expect(context.runSelection).toEqual({ policy: "latest-failed", runId: newer.runId })
  })

  it("details explicitly requested nodes and names the missing ones", async () => {
    const seed = await seedFailure()
    const context = await debugContext({
      workspaceId: seed.workspaceId,
      workflowId: seed.workflowId,
      nodeIds: ["end", "ghost"],
    })
    expect(context.nodes.map((node) => node.nodeId)).toContain("end")
    expect(context.missingNodeIds).toEqual(["ghost"])
  })

  it("matches the MCP tool result exactly (second transport parity)", async () => {
    const seed = await seedFailure()
    const args = { workspaceId: seed.workspaceId, workflowId: seed.workflowId }
    const viaIpc = await debugContext(args)

    const client = await connectClient()
    const result = await client.callTool({ name: "workflows_debugContext", arguments: args })
    expect((result as { isError?: boolean }).isError).toBeFalsy()
    const viaMcp = JSON.parse(textOf(result as { content: Array<{ type: string; text?: string }> }))
    expect(viaMcp).toEqual(viaIpc)
    expect((result as { structuredContent?: unknown }).structuredContent).toEqual({ result: viaIpc })
    await client.close()
  })
})

describe("Phase 3 — empty, denied and stale cases are explicit", () => {
  it("returns a valid empty context when no failed run exists", async () => {
    const workspaceId = await seedWorkspace()
    const workflow = await dispatchOk<{ workflowId: string }>("workflows", "create", { workspaceId, name: "never-ran" })

    const context = await debugContext({ workspaceId, workflowId: workflow.workflowId })
    expect(context.runSelection).toEqual({ policy: "latest-failed", runId: null })
    expect(context.run).toBeNull()
    expect(context.failureSummary).toMatchObject({ failedNodeIds: [], failedNodeCount: 0, blockedNodeIds: [], blockedNodeCount: 0 })
    expect(context.evidence).toEqual([])
    expect(context.diagnosis.status).toBe("complete")
    expect(context.nextReads.map((read) => read.tool)).toContain("runs_history")
  })

  it("blames neither end nodes nor untaken branches on a green terminal run", async () => {
    const workspaceId = await seedWorkspace()
    const workflow = await dispatchOk<{ workflowId: string }>("workflows", "create", {
      workspaceId,
      name: "branching",
      nodes: [
        { nodeId: "start", type: "start", position: { x: 0, y: 0 } },
        { nodeId: "login", type: "http-request", position: { x: 100, y: 0 }, config: { method: "POST", url: "https://example.test/login" } },
        {
          nodeId: "check",
          type: "assertion",
          position: { x: 200, y: 0 },
          config: { assertions: [{ source: "prev", path: "response.statusCode", operator: "equals", expectedValue: 200 }] },
        },
        { nodeId: "ok", type: "http-request", position: { x: 300, y: 0 }, config: { method: "GET", url: "https://example.test/orders" } },
        { nodeId: "recover", type: "http-request", position: { x: 300, y: 120 }, config: { method: "POST", url: "https://example.test/retry" } },
        { nodeId: "end", type: "end", position: { x: 400, y: 0 } },
        { nodeId: "end-fail", type: "end", position: { x: 400, y: 120 } },
      ],
      edges: [
        { edgeId: "e1", source: "start", target: "login" },
        { edgeId: "e2", source: "login", target: "check" },
        { edgeId: "e3", source: "check", target: "ok", sourceHandle: "pass" },
        { edgeId: "e4", source: "check", target: "recover", sourceHandle: "fail" },
        { edgeId: "e5", source: "ok", target: "end" },
        { edgeId: "e6", source: "recover", target: "end-fail" },
      ],
    })
    const run = runRepository.create({ workspaceId, workflowId: workflow.workflowId })
    // Everything that ran passed; the executor persists no row for an `end`
    // node and none for the `fail` branch it never took, so neither is
    // evidence of a blocked node and neither may eat a node-detail slot.
    runRepository.update(run.runId, {
      status: "completed",
      results: [
        { nodeId: "login", status: "passed", duration: 5, response: { statusCode: 200 } },
        { nodeId: "check", status: "passed", duration: 1 },
        { nodeId: "ok", status: "passed", duration: 4, response: { statusCode: 200 } },
      ],
      failedNodes: [],
    })

    const context = await debugContext({ workspaceId, workflowId: workflow.workflowId, runId: run.runId })
    expect(context.failureSummary).toMatchObject({ failedNodeIds: [], blockedNodeIds: [], blockedNodeCount: 0 })
    expect(context.nodes.map((node) => node.nodeId)).toEqual([])
    expect(context.totalRelevantNodeCount).toBe(0)
  })

  it("hides workflows outside the workspace", async () => {
    const seed = await seedFailure()
    const error = await dispatchErr("workflows", "debugContext", {
      workspaceId: "ws-not-mine",
      workflowId: seed.workflowId,
    })
    expect(error.code).toBe("not_found")
  })

  it("hides a run that belongs to another workflow", async () => {
    const seed = await seedFailure()
    const other = await dispatchOk<{ workflowId: string }>("workflows", "create", {
      workspaceId: seed.workspaceId,
      name: "other",
    })
    const foreign = runRepository.create({ workspaceId: seed.workspaceId, workflowId: other.workflowId })

    const error = await dispatchErr("workflows", "debugContext", {
      workspaceId: seed.workspaceId,
      workflowId: seed.workflowId,
      runId: foreign.runId,
    })
    expect(error.code).toBe("not_found")
  })

  it("labels historical correlation unknown after the graph moved on", async () => {
    const seed = await seedFailure()
    const stored = await dispatchOk<{ rev: number }>("workflows", "get", {
      workspaceId: seed.workspaceId,
      workflowId: seed.workflowId,
    })
    await dispatchOk("workflows", "patch", {
      workspaceId: seed.workspaceId,
      workflowId: seed.workflowId,
      expectedRevision: stored.rev,
      setVariables: { editedAfterRun: "yes" },
    })

    const context = await debugContext({ workspaceId: seed.workspaceId, workflowId: seed.workflowId })
    // Current rev advanced past the revision the run executed against.
    expect(context.workflow.rev).toBe(seed.workflowRev + 1)
    expect(context.run?.runId).toBe(seed.runId)
    expect(context.graphCorrelation).toMatchObject({ status: "unknown" })
    expect(context.graphCorrelation.reason.length).toBeGreaterThan(0)
  })
})

describe("Phase 3 — provenance edge cases", () => {
  it("resolves secret names missing from the run record as unresolved, not from-run", async () => {
    const workspaceId = await seedWorkspace()
    const workflow = await dispatchOk<{ workflowId: string }>("workflows", "create", {
      workspaceId,
      name: "unresolved-secret",
      nodes: [
        {
          nodeId: "call",
          type: "http-request",
          position: { x: 0, y: 0 },
          config: { method: "GET", url: "https://example.test", headers: [{ key: "X-Token", value: "{{secrets.NEVER_RECORDED}}" }] },
        },
      ],
    })
    const run = runRepository.create({ workspaceId, workflowId: workflow.workflowId })
    runRepository.update(run.runId, {
      status: "failed",
      results: [{ nodeId: "call", status: "failed", duration: 3, error: "boom" }],
      failedNodes: ["call"],
    })

    const context = await debugContext({ workspaceId, workflowId: workflow.workflowId })
    expect(context.secrets).toEqual([{ name: "NEVER_RECORDED", resolved: false, scopeType: null, fromRun: false }])
  })

  it("prefers the run's environment over the workflow's current selection", async () => {
    const workspaceId = await seedWorkspace()
    const first = await dispatchOk<{ environmentId: string }>("environments", "create", {
      workspaceId,
      name: "first",
      variables: { ONLY_FIRST: "1" },
    })
    const second = await dispatchOk<{ environmentId: string }>("environments", "create", {
      workspaceId,
      name: "second",
      variables: {},
    })
    const workflow = await dispatchOk<{ workflowId: string }>("workflows", "create", {
      workspaceId,
      name: "env-switch",
      selectedEnvironmentId: second.environmentId,
      nodes: [{
        nodeId: "call",
        type: "http-request",
        position: { x: 0, y: 0 },
        config: { method: "GET", url: "https://example.test/{{env.ONLY_FIRST}}" },
      }],
    })
    const run = runRepository.create({ workspaceId, workflowId: workflow.workflowId })
    runRepository.update(run.runId, {
      status: "failed",
      selectedEnvironmentId: first.environmentId,
      results: [{ nodeId: "call", status: "failed", duration: 3, error: "boom" }],
      failedNodes: ["call"],
    })

    const context = await debugContext({ workspaceId, workflowId: workflow.workflowId })
    expect(context.environment.evaluatedEnvironmentId).toBe(first.environmentId)
    expect(context.environment.keys).toEqual([
      { name: "ONLY_FIRST", present: true, sourceEnvironmentId: first.environmentId, sourceEnvironmentName: "first" },
    ])
  })
})

describe("Phase 3 — budgets, truncation and continuation", () => {
  async function seedManyFailures(count: number, error?: string): Promise<{ workspaceId: string; workflowId: string; runId: string }> {
    const workspaceId = await seedWorkspace()
    const nodes = [{ nodeId: "start", type: "start", position: { x: 0, y: 0 } }]
    const edges: Array<Record<string, unknown>> = []
    for (let index = 0; index < count; index += 1) {
      nodes.push({
        nodeId: `n${index}`,
        type: "http-request",
        position: { x: index * 10, y: 0 },
        // A fat config so the aggregate budget must actually engage.
        config: { method: "POST", url: "https://example.test/submit", body: `{"filler":"${"y".repeat(2000)}"}` },
      } as never)
      edges.push({ edgeId: `e${index}`, source: index === 0 ? "start" : `n${index - 1}`, target: `n${index}` })
    }
    const workflow = await dispatchOk<{ workflowId: string }>("workflows", "create", { workspaceId, name: "many", nodes, edges })
    const run = runRepository.create({ workspaceId, workflowId: workflow.workflowId })
    runRepository.update(run.runId, {
      status: "failed",
      results: Array.from({ length: count }, (_, index) => ({
        nodeId: `n${index}`,
        status: "failed" as const,
        duration: index,
        error: error ?? `failure ${index}: ${"z".repeat(3000)}`,
      })),
      failedNodes: Array.from({ length: count }, (_, index) => `n${index}`),
    })
    return { workspaceId, workflowId: workflow.workflowId, runId: run.runId }
  }

  it("caps detail entries while counts still describe every failure", async () => {
    const seed = await seedManyFailures(10)
    const context = await debugContext({ workspaceId: seed.workspaceId, workflowId: seed.workflowId })

    expect(context.failureSummary.failedNodeCount).toBe(10)
    expect(context.nodes.length).toBeLessThanOrEqual(5)
    // Ten failures plus the start node feeding the first one.
    expect(context.totalRelevantNodeCount).toBe(11)
    expect(context.omittedNodeIds).toHaveLength(11 - context.nodes.length)
    expect(context.evidence.length).toBeLessThanOrEqual(10)
    expect(context.budgetBytes).toBeLessThanOrEqual(context.budgetLimitBytes)
    expect(Buffer.byteLength(JSON.stringify(context), "utf8")).toBeLessThanOrEqual(32 * 1024)

    const reads = new Map(context.nextReads.map((read) => [read.tool, read]))
    expect(reads.has("workflows_get")).toBe(true)
    const getArgs = reads.get("workflows_get")?.args as { view?: string; nodeIds?: string[] }
    expect(getArgs.view).toBe("nodes")
    expect(getArgs.nodeIds).toEqual(expect.arrayContaining(context.omittedNodeIds.slice(0, 50)))
  })

  it("honours issueLimit with explicit omission counts and a diagnose continuation", async () => {
    const seed = await seedFailure()
    const context = await debugContext({
      workspaceId: seed.workspaceId,
      workflowId: seed.workflowId,
      issueLimit: 1,
    })
    if (context.diagnosis.status !== "complete") throw new Error("expected a complete diagnosis")
    expect(context.diagnosis.items).toHaveLength(1)
    expect(context.diagnosis.omittedItemCount).toBeGreaterThan(0)
    const reads = new Map(context.nextReads.map((read) => [read.tool, read]))
    expect(reads.has("workflow_diagnose")).toBe(true)
    expect(reads.get("workflow_diagnose")?.args).toMatchObject({
      workspaceId: seed.workspaceId,
      workflowId: seed.workflowId,
      runId: seed.runId,
    })
  })

  it("truncates long errors with byte accounting instead of silent cuts", async () => {
    const seed = await seedManyFailures(1)
    const context = await debugContext({
      workspaceId: seed.workspaceId,
      workflowId: seed.workflowId,
      errorBytes: 64,
    })
    const item = context.evidence[0]
    expect(item).toBeDefined()
    expect(item?.errorTruncated).toBe(true)
    expect(item?.errorBytes).toBeGreaterThan(64)
    expect(Buffer.byteLength(item?.errorPreview ?? "", "utf8")).toBeLessThanOrEqual(64)
    expect(item?.moreDetail.tool).toBe("runs_getNodeResult")
  })

  it("keeps a non-ASCII error whole when it fits the byte budget", async () => {
    // byteLength > length here, so a character-count budget would silently cut the tail.
    const error = "café — naïve 🚀 upstream"
    const seed = await seedManyFailures(1, error)
    const context = await debugContext({
      workspaceId: seed.workspaceId,
      workflowId: seed.workflowId,
      errorBytes: 64,
    })
    const item = context.evidence[0]
    expect(item?.errorPreview).toBe(error)
    expect(item?.errorTruncated).toBe(false)
    expect(item?.errorBytes).toBe(Buffer.byteLength(error, "utf8"))
  })

  it("bounds the missing-env-key continuation hint so the aggregate budget still holds", async () => {
    // The trimming ladder runs before nextReads is appended, so a hint that
    // named every missing key pushed the response back over the budget it had
    // just enforced — with nothing left marked omittable.
    const workspaceId = await seedWorkspace()
    const environment = await dispatchOk<{ environmentId: string }>("environments", "create", {
      workspaceId,
      name: "empty",
      variables: {},
    })
    const keys = Array.from({ length: 300 }, (_, index) => `MISSING_KEY_${String(index).padStart(4, "0")}`)
    const workflow = await dispatchOk<{ workflowId: string }>("workflows", "create", {
      workspaceId,
      name: "env-heavy",
      selectedEnvironmentId: environment.environmentId,
      nodes: [
        { nodeId: "start", type: "start", position: { x: 0, y: 0 } },
        {
          nodeId: "call",
          type: "http-request",
          position: { x: 100, y: 0 },
          config: { method: "POST", url: "https://example.test/submit", body: keys.map((key) => `{{env.${key}}}`).join(" ") },
        },
      ],
      edges: [{ edgeId: "e1", source: "start", target: "call" }],
    })
    const run = runRepository.create({ workspaceId, workflowId: workflow.workflowId })
    runRepository.update(run.runId, {
      status: "failed",
      selectedEnvironmentId: environment.environmentId,
      results: [{ nodeId: "call", status: "failed" as const, duration: 1, error: "boom" }],
      failedNodes: ["call"],
    })

    const context = await debugContext({ workspaceId, workflowId: workflow.workflowId })

    expect(context.environment.totalKeyCount).toBe(keys.length)
    expect(context.budgetBytes).toBeLessThanOrEqual(context.budgetLimitBytes)
    expect(Buffer.byteLength(JSON.stringify(context), "utf8")).toBeLessThanOrEqual(32 * 1024)
    // The hint states the full count and how many names it left out, so the
    // omission is arithmetic rather than a silently sliced list.
    const envRead = context.nextReads.find((read) => read.tool === "environments_get")
    const stated = /^(\d+) referenced env key\(s\) \(([^)]*)\) missing/.exec(envRead?.reason ?? "")
    expect(stated).not.toBeNull()
    const listed = (stated?.[2] ?? "").split(", ")
    const unnamed = Number(/^\+(\d+) more$/.exec(listed[listed.length - 1] ?? "")?.[1])
    expect(listed.length - 1 + unnamed).toBe(Number(stated?.[1]))
  })

  it("rejects oversized node and issue selections", async () => {
    const seed = await seedFailure()
    const tooManyNodes = await dispatchErr("workflows", "debugContext", {
      workspaceId: seed.workspaceId,
      workflowId: seed.workflowId,
      nodeIds: Array.from({ length: 51 }, (_, index) => `n${index}`),
    })
    expect(tooManyNodes.code).toBe("validation")
    const badLimit = await dispatchErr("workflows", "debugContext", {
      workspaceId: seed.workspaceId,
      workflowId: seed.workflowId,
      issueLimit: 500,
    })
    expect(badLimit.code).toBe("validation")
  })
})

describe("Phase 3 — redaction and whitelist", () => {
  it("withholds credential values from configs and evidence over MCP, keeping names", async () => {
    const workspaceId = await seedWorkspace()
    const workflow = await dispatchOk<{ workflowId: string }>("workflows", "create", {
      workspaceId,
      name: "leak-check",
      nodes: [{
        nodeId: "login",
        type: "http-request",
        position: { x: 0, y: 0 },
        config: {
          method: "POST",
          url: "https://example.test/login?token=debug-context-guard-4",
          headers: [{ key: "Authorization", value: "Bearer debug-context-guard-4" }],
          body: "{\"password\":\"debug-context-guard-4\"}",
        },
      }],
    })
    const run = runRepository.create({ workspaceId, workflowId: workflow.workflowId })
    runRepository.update(run.runId, {
      status: "failed",
      results: [{
        nodeId: "login",
        status: "failed",
        duration: 7,
        response: { statusCode: 500, body: { password: "debug-context-guard-4", ok: false } },
        error: "Request failed with status 500",
      }],
      failedNodes: ["login"],
    })

    const client = await connectClient()
    const result = await client.callTool({
      name: "workflows_debugContext",
      arguments: { workspaceId, workflowId: workflow.workflowId },
    })
    const text = textOf(result as { content: Array<{ type: string; text?: string }> })
    expect((result as { isError?: boolean }).isError).toBeFalsy()
    // Key-name and URL-shape redaction withholds the credential everywhere it
    // is stored (config url/headers/body); evidence carries no body previews,
    // only status codes and the error text — the same error-echo contract as
    // runs_getNodeResult, whose executor-side masking happens before persist.
    expect(text).not.toContain("debug-context-guard-4")
    // Structure survives redaction: the failing node and its evidence are legible.
    const parsed = JSON.parse(text) as WorkflowDebugContext
    expect(parsed.failureSummary.failedNodeIds).toEqual(["login"])
    expect(parsed.evidence[0]?.nodeId).toBe("login")
    expect(parsed.evidence[0]?.responseStatusCode).toBe(500)
    expect(JSON.stringify(parsed.nodes)).toContain("<SECRET>")
    await client.close()
  })

  it("publishes the debug context on the whitelist and keeps the exclusions", async () => {
    const names = new Set(MCP_TOOLS.map(toolName))
    expect(names.has("workflows_debugContext")).toBe(true)

    const client = await connectClient()
    const { tools } = await client.listTools()
    const listed = tools.map((tool) => tool.name)
    expect(listed).toContain("workflows_debugContext")
    expect(listed).not.toContain("secrets_set")
    expect(listed).not.toContain("workflows_list")
    const debug = tools.find((tool) => tool.name === "workflows_debugContext")
    expect(debug?.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false })
    await client.close()

    const excluded = new Set(MCP_TOOLS.map((spec) => `${spec.domain}.${spec.action}`))
    for (const name of [
      "secrets.set",
      "secrets.delete",
      "secrets.duplicate",
      "secrets.moveToScope",
      "runs.getArtifacts",
      "runs.openArtifact",
      "runs.saveArtifactAs",
    ]) {
      expect(excluded.has(name), name).toBe(false)
    }
  })

  it("states budgets and continuations in the debug-context description", async () => {
    const byName = new Map(MCP_TOOLS.map((spec) => [toolName(spec), spec.description]))
    const description = byName.get("workflows_debugContext") ?? ""
    expect(description).toMatch(/32 KiB/)
    expect(description).toContain("omittedNodeIds")
    expect(description).toContain("nextReads")
    expect(description).toContain("runRev")
  })
})
