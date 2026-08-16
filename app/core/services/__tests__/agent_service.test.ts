import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { AgentDefinition } from "@shared/types/AgentDefinition"
import { LocalOwnerProvider } from "../../auth/LocalOwnerProvider"
import type { PtyLauncher } from "../../agents/pty_launcher"
import type { PtySpawnRequest } from "../../agents/pty_protocol"
import { initDatabase, type InitializedDatabase } from "../../db"
import { AgentRepository, CollectionRepository, WorkflowRepository, WorkspaceRepository } from "../../repositories"
import { AgentService, type AgentEnvironment } from "../agent_service"
import { ScopeResolver } from "../scope_resolver"

let db: InitializedDatabase
let workspaces: WorkspaceRepository
let workflows: WorkflowRepository
let collections: CollectionRepository
let agentRepository: AgentRepository
let service: AgentService
let pickDirectory: ReturnType<typeof vi.fn>
let pty: FakePtyLauncher
let tempDir: string
let agentFilesDir: string

/**
 * Stands in for `AgentProcessManager`. Records what it was asked to spawn,
 * because the argv and cwd handed to a PTY are the whole contract between the
 * service and a real process — everything else about an embedded launch is the
 * host's business.
 */
class FakePtyLauncher implements PtyLauncher {
  public readonly spawned: PtySpawnRequest[] = []
  public readonly writes: { readonly sessionId: string; readonly data: string }[] = []
  public readonly resizes: { readonly sessionId: string; readonly cols: number; readonly rows: number }[] = []
  public readonly killed: string[] = []
  public readonly paused: { readonly sessionId: string; readonly paused: boolean }[] = []
  public nextPid = 4242
  public failWith: string | null = null
  public live = true

  start = (request: PtySpawnRequest): Promise<number> => {
    this.spawned.push(request)
    return this.failWith === null ? Promise.resolve(this.nextPid) : Promise.reject(new Error(this.failWith))
  }
  write = (sessionId: string, data: string): void => void this.writes.push({ sessionId, data })
  resize = (sessionId: string, cols: number, rows: number): void => void this.resizes.push({ sessionId, cols, rows })
  setPaused = (sessionId: string, paused: boolean): void => void this.paused.push({ sessionId, paused })
  kill = (sessionId: string): void => void this.killed.push(sessionId)
  canAttach = (): boolean => this.live
}

/**
 * An agent definition whose `detectCmd` is guaranteed to resolve on every
 * platform CI runs on: the Node binary already running the test. What is being
 * exercised is the service's composition, not PATH lookup — that has its own
 * tests against a purpose-built stub in `core/agents/__tests__`.
 */
function realExecutableAgent(): AgentDefinition {
  return {
    ...CUSTOM_AGENT,
    agentKey: "stub-runner",
    name: "Stub Runner",
    detectCmd: process.execPath,
    argv: ["--version"],
  }
}

const CUSTOM_AGENT: AgentDefinition = {
  agentKey: "my-agent",
  name: "My Agent",
  detectCmd: "my-agent",
  argv: ["chat"],
  expectedProcess: "my-agent",
  env: {},
  promptMode: "flag",
  promptFlag: "--prompt",
  mcpConfigArgs: ["--mcp-config", "{path}"],
  unsupportedPlatforms: [],
  installUrl: null,
}

beforeEach(() => {
  db = initDatabase({ databasePath: ":memory:" })
  workspaces = new WorkspaceRepository(db.kvStore)
  workflows = new WorkflowRepository(db.kvStore)
  collections = new CollectionRepository(db.kvStore)
  agentRepository = new AgentRepository(db.kvStore)
  const scopeResolver = new ScopeResolver({
    workspaceExists: (id) => workspaces.getById(id) !== undefined,
    environmentExists: () => false,
  })
  seedCounter = 0
  pickDirectory = vi.fn()
  pty = new FakePtyLauncher()
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "apiweave-agent-cwd-"))
  agentFilesDir = path.join(tempDir, "agent-files")
  const environment: AgentEnvironment = {
    pickDirectory: pickDirectory as unknown as AgentEnvironment["pickDirectory"],
    getMcpConfig: () => null,
    agentFilesDir,
    pty,
  }
  service = new AgentService(
    agentRepository,
    workflows,
    collections,
    new LocalOwnerProvider(),
    scopeResolver,
    environment,
  )
})

afterEach(() => {
  db.close()
  fs.rmSync(tempDir, { recursive: true, force: true })
})

let seedCounter = 0

function seed() {
  seedCounter += 1
  const workspaceId = workspaces.create({ name: `Local ${seedCounter}`, slug: `local-${seedCounter}` }).workspaceId
  const collection = collections.create({ workspaceId, name: "Shop API" })
  const workflow = workflows.create({
    workspaceId,
    name: "Checkout",
    collectionId: collection.collectionId,
  })
  return { workspaceId, projectId: collection.collectionId, workflowId: workflow.workflowId }
}

describe("AgentService — roster", () => {
  it("returns the built-in roster with the default marked", async () => {
    const { workspaceId } = seed()
    const roster = await service.listRoster(workspaceId)

    expect(roster.map((entry) => entry.definition.agentKey)).toContain("claude")
    expect(roster.filter((entry) => entry.isDefault)).toHaveLength(1)
    expect(roster.find((entry) => entry.isDefault)?.definition.agentKey).toBe("claude")
    // Every row carries a resolved state, never an unanswered "maybe".
    for (const entry of roster) {
      expect(["not-found", "ready", "broken", "unsupported"]).toContain(entry.availability.state)
    }
  })

  it("adds a custom agent and reports it as deletable", async () => {
    const { workspaceId } = seed()
    const saved = await service.saveCustomAgent(workspaceId, CUSTOM_AGENT)

    expect(saved.isCustom).toBe(true)
    expect(saved.definition.promptFlag).toBe("--prompt")

    const roster = await service.listRoster(workspaceId)
    const entry = roster.find((row) => row.definition.agentKey === "my-agent")
    // The behavioural half survives the round trip through `options_json`.
    expect(entry?.definition.promptMode).toBe("flag")
    expect(entry?.definition.mcpConfigArgs).toEqual(["--mcp-config", "{path}"])
  })

  it("refuses a custom agent that shadows a built-in key", async () => {
    const { workspaceId } = seed()
    await expect(service.saveCustomAgent(workspaceId, { ...CUSTOM_AGENT, agentKey: "claude" })).rejects.toThrow(
      /built-in/,
    )
  })

  it("lets a built-in be overridden, and the override replaces the shipped definition", async () => {
    const { workspaceId } = seed()
    agentRepository.upsertDefinition(workspaceId, {
      ...CUSTOM_AGENT,
      agentKey: "claude",
      name: "Claude (wrapper)",
      detectCmd: "claude-wrapper",
      isCustom: false,
    })

    const roster = await service.listRoster(workspaceId)
    const claude = roster.find((entry) => entry.definition.agentKey === "claude")
    expect(claude?.definition.detectCmd).toBe("claude-wrapper")
    // An override is not a user-created agent, so it cannot be deleted away.
    expect(claude?.isCustom).toBe(false)
    // Overriding must not duplicate the row it replaced.
    expect(roster.filter((entry) => entry.definition.agentKey === "claude")).toHaveLength(1)
  })

  it("rejects a default agent that is not in the roster", async () => {
    const { workspaceId } = seed()
    await expect(service.setDefaultAgentKey(workspaceId, "nope")).rejects.toThrow(/not found/)
  })

  /**
   * The default lives in `app_settings` with no FK to the definition it names,
   * so deleting the agent it points at used to leave the roster with no default
   * marked at all — and `getDefaultAgentKey` reporting a key nothing can launch.
   */
  it("clears the stored default when the agent it named is deleted", async () => {
    const { workspaceId } = seed()
    await service.saveCustomAgent(workspaceId, CUSTOM_AGENT)
    await service.setDefaultAgentKey(workspaceId, "my-agent")

    await service.deleteCustomAgent(workspaceId, "my-agent")

    await expect(service.getDefaultAgentKey(workspaceId)).resolves.toBe("claude")
    const roster = await service.listRoster(workspaceId)
    expect(roster.filter((entry) => entry.isDefault)).toHaveLength(1)
  })

  it("leaves another agent's default alone when a custom agent is deleted", async () => {
    const { workspaceId } = seed()
    await service.saveCustomAgent(workspaceId, CUSTOM_AGENT)
    await service.setDefaultAgentKey(workspaceId, "codex")

    await service.deleteCustomAgent(workspaceId, "my-agent")

    await expect(service.getDefaultAgentKey(workspaceId)).resolves.toBe("codex")
  })

  /**
   * The roster hides the delete button for a built-in override, but the handler
   * behind it is reachable regardless of what the UI chose to render — and
   * deleting one silently reverts the user's edited `detectCmd` to the shipped
   * definition.
   */
  it("refuses to delete a built-in override through the service", async () => {
    const { workspaceId } = seed()
    agentRepository.upsertDefinition(workspaceId, {
      ...CUSTOM_AGENT,
      agentKey: "claude",
      detectCmd: "claude-wrapper",
      isCustom: false,
    })

    await expect(service.deleteCustomAgent(workspaceId, "claude")).rejects.toThrow(/built-in/)
    const roster = await service.listRoster(workspaceId)
    expect(roster.find((entry) => entry.definition.agentKey === "claude")?.definition.detectCmd).toBe("claude-wrapper")
  })

  /**
   * The cache is invalidated on save and delete, but those are not the only
   * ways the definition list changes — a row written straight through the
   * repository, or a built-in added by an app update, lands inside a warm TTL.
   * The miss used to fall through to a hardcoded `not-found`, telling the user
   * an agent they have installed is not installed.
   */
  it("probes an agent the warm cache never saw instead of calling it not-found", async () => {
    const { workspaceId } = seed()
    // Warm the cache with the built-in roster only.
    await service.listRoster(workspaceId)

    agentRepository.upsertDefinition(workspaceId, {
      ...realExecutableAgent(),
      agentKey: "late-arrival",
      name: "Late Arrival",
    })

    const roster = await service.listRoster(workspaceId)
    const entry = roster.find((row) => row.definition.agentKey === "late-arrival")
    expect(entry?.availability.state).toBe("ready")
    expect(entry?.availability.resolvedPath).not.toBeNull()
  })

  /**
   * The availability cache is per workspace. A single global slot would hand
   * the second workspace the first one's probe results, and every custom agent
   * only the second workspace knows would surface as "not-found" — a confident
   * answer for a probe that never ran.
   */
  it("probes each workspace's own roster instead of reusing another workspace's cache", async () => {
    const first = seed()
    const second = seed()
    await service.saveCustomAgent(first.workspaceId, {
      ...realExecutableAgent(),
      agentKey: "agent-a",
      name: "Agent A",
    })
    await service.saveCustomAgent(second.workspaceId, {
      ...realExecutableAgent(),
      agentKey: "agent-b",
      name: "Agent B",
    })

    const firstRoster = await service.listRoster(first.workspaceId)
    const secondRoster = await service.listRoster(second.workspaceId)

    expect(firstRoster.find((row) => row.definition.agentKey === "agent-a")?.availability.state).toBe("ready")
    expect(secondRoster.find((row) => row.definition.agentKey === "agent-b")?.availability.state).toBe("ready")
  })
})

describe("AgentService — local paths", () => {
  it("resolves nothing when no path has been set", async () => {
    const { workspaceId, projectId } = seed()
    await expect(service.resolveLocalPath(workspaceId, { kind: "project", id: projectId })).resolves.toEqual({
      localPath: null,
      source: "none",
    })
  })

  it("inherits the project path for a workflow that has none of its own", async () => {
    const { workspaceId, projectId, workflowId } = seed()
    pickDirectory.mockResolvedValue("/src/shop-api")
    await service.chooseLocalPath(workspaceId, { kind: "project", id: projectId })

    await expect(service.resolveLocalPath(workspaceId, { kind: "workflow", id: workflowId })).resolves.toEqual({
      localPath: "/src/shop-api",
      source: "project",
    })
  })

  it("prefers a workflow override over the project path", async () => {
    const { workspaceId, projectId, workflowId } = seed()
    pickDirectory.mockResolvedValueOnce("/src/shop-api")
    await service.chooseLocalPath(workspaceId, { kind: "project", id: projectId })
    pickDirectory.mockResolvedValueOnce("/src/shop-api/packages/checkout")
    await service.chooseLocalPath(workspaceId, { kind: "workflow", id: workflowId })

    await expect(service.resolveLocalPath(workspaceId, { kind: "workflow", id: workflowId })).resolves.toEqual({
      localPath: "/src/shop-api/packages/checkout",
      source: "workflow",
    })
  })

  it("stores nothing when the picker is cancelled", async () => {
    const { workspaceId, projectId } = seed()
    pickDirectory.mockResolvedValue(null)

    await expect(service.chooseLocalPath(workspaceId, { kind: "project", id: projectId })).resolves.toBeNull()
    await expect(service.resolveLocalPath(workspaceId, { kind: "project", id: projectId })).resolves.toMatchObject({
      localPath: null,
    })
  })

  /**
   * The scope id is renderer-controlled. Without the workspace check it would be
   * a read — and, through the picker, a write — of a path belonging to a
   * workspace the caller was never authorized against.
   */
  it("refuses a scope from another workspace", async () => {
    const first = seed()
    const second = seed()

    await expect(
      service.resolveLocalPath(first.workspaceId, { kind: "project", id: second.projectId }),
    ).rejects.toThrow(/not found/)
    await expect(
      service.chooseLocalPath(first.workspaceId, { kind: "workflow", id: second.workflowId }),
    ).rejects.toThrow(/not found/)
    expect(pickDirectory).not.toHaveBeenCalled()
  })

  it("clears a stored path", async () => {
    const { workspaceId, projectId } = seed()
    pickDirectory.mockResolvedValue("/src/shop-api")
    await service.chooseLocalPath(workspaceId, { kind: "project", id: projectId })

    await service.clearLocalPath(workspaceId, { kind: "project", id: projectId })
    await expect(service.resolveLocalPath(workspaceId, { kind: "project", id: projectId })).resolves.toMatchObject({
      localPath: null,
    })
  })
})

describe("AgentService — launching", () => {
  it("refuses to launch without a local folder rather than guessing one", async () => {
    const { workspaceId, projectId } = seed()
    await expect(
      service.launchExternal({
        workspaceId,
        agentKey: "claude",
        scope: { kind: "project", id: projectId },
      }),
    ).rejects.toThrow(/No local folder is set/)
  })

  it("refuses to launch into a folder that no longer exists", async () => {
    const { workspaceId, projectId } = seed()
    pickDirectory.mockResolvedValue("/definitely/not/here")
    await service.chooseLocalPath(workspaceId, { kind: "project", id: projectId })

    await expect(
      service.launchExternal({
        workspaceId,
        agentKey: "claude",
        scope: { kind: "project", id: projectId },
      }),
    ).rejects.toThrow(/no longer exists/)
  })
})

describe("AgentService — embedded sessions", () => {
  /** A workspace with a real folder set and an agent that actually resolves. */
  async function seedLaunchable() {
    const seeded = seed()
    await service.saveCustomAgent(seeded.workspaceId, realExecutableAgent())
    pickDirectory.mockResolvedValue(tempDir)
    await service.chooseLocalPath(seeded.workspaceId, { kind: "project", id: seeded.projectId })
    return seeded
  }

  function launchRequest(seeded: Awaited<ReturnType<typeof seedLaunchable>>, cols = 100, rows = 30) {
    return {
      workspaceId: seeded.workspaceId,
      agentKey: "stub-runner",
      scope: { kind: "project" as const, id: seeded.projectId },
      cols,
      rows,
    }
  }

  it("spawns in the resolved folder and records a running session with its pid", async () => {
    const seeded = await seedLaunchable()
    const session = await service.launchEmbedded(launchRequest(seeded))

    expect(session.launchMode).toBe("embedded")
    expect(session.status).toBe("running")
    expect(session.pid).toBe(4242)
    expect(session.cwd).toBe(tempDir)

    const spawned = pty.spawned[0]
    expect(spawned?.cwd).toBe(tempDir)
    expect(spawned?.sessionId).toBe(session.sessionId)
    // The registry's argv, not the renderer's: the request carried no argv at all.
    expect(spawned?.args).toEqual(["--version"])
    expect(spawned?.env["APIWEAVE_WORKSPACE_ID"]).toBe(seeded.workspaceId)
  })

  /**
   * A terminal that has not been laid out reports zero columns, and ConPTY
   * throws on a zero dimension — so the clamp is what keeps a mount race from
   * looking like a broken agent.
   */
  it("clamps a geometry the renderer cannot yet know", async () => {
    const seeded = await seedLaunchable()
    await service.launchEmbedded(launchRequest(seeded, 0, 0))

    expect(pty.spawned[0]?.cols).toBeGreaterThanOrEqual(2)
    expect(pty.spawned[0]?.rows).toBeGreaterThanOrEqual(1)
  })

  /**
   * The MCP wiring a custom agent gets is its own flag template, not a
   * Claude-shaped assumption: `{path}` is replaced with the written config
   * file's location, and the token travels inside that file rather than in
   * argv, where any process listing on the machine could read it.
   */
  it("renders the agent's own MCP flag template with the written config path", async () => {
    const seeded = await seedLaunchable()
    const wired = new AgentService(
      agentRepository,
      workflows,
      collections,
      new LocalOwnerProvider(),
      new ScopeResolver({
        workspaceExists: (id) => workspaces.getById(id) !== undefined,
        environmentExists: () => false,
      }),
      {
        pickDirectory: pickDirectory as unknown as AgentEnvironment["pickDirectory"],
        getMcpConfig: () => ({ url: "http://127.0.0.1:47271", token: "secret-token", port: 47271 }),
        agentFilesDir,
        pty,
      },
    )
    await wired.saveCustomAgent(seeded.workspaceId, {
      ...realExecutableAgent(),
      agentKey: "wired-runner",
      mcpConfigArgs: ["--mcp-config={path}", "--project-local"],
    })

    await wired.launchEmbedded({
      workspaceId: seeded.workspaceId,
      agentKey: "wired-runner",
      scope: { kind: "project", id: seeded.projectId },
      cols: 100,
      rows: 30,
    })

    const spawned = pty.spawned[0]
    expect(spawned?.args).toContain("--project-local")
    const flag = spawned?.args.find((arg) => arg.startsWith("--mcp-config="))
    expect(flag).toBeDefined()
    expect(flag).not.toContain("secret-token")
    const config = JSON.parse(fs.readFileSync(String(flag).slice("--mcp-config=".length), "utf8")) as {
      mcpServers: { apiweave: { url: string; headers: { Authorization: string } } }
    }
    expect(config.mcpServers.apiweave.url).toBe("http://127.0.0.1:47271")
    expect(config.mcpServers.apiweave.headers.Authorization).toBe("Bearer secret-token")
  })

  it("records the failure on the session when the spawn never starts", async () => {
    const seeded = await seedLaunchable()
    pty.failWith = "the terminal backend did not start"

    await expect(service.launchEmbedded(launchRequest(seeded))).rejects.toThrow(/did not start/)

    const sessions = await service.listSessions(seeded.workspaceId)
    expect(sessions[0]?.status).toBe("failed")
    expect(sessions[0]?.error).toMatch(/did not start/)
  })

  it("refuses the whole feature honestly when there is no PTY backend", async () => {
    const seeded = await seedLaunchable()
    const withoutPty = new AgentService(
      agentRepository,
      workflows,
      collections,
      new LocalOwnerProvider(),
      new ScopeResolver({
        workspaceExists: (id) => workspaces.getById(id) !== undefined,
        environmentExists: () => false,
      }),
      {
        pickDirectory: pickDirectory as unknown as AgentEnvironment["pickDirectory"],
        getMcpConfig: () => null,
        agentFilesDir,
      },
    )

    await expect(withoutPty.launchEmbedded(launchRequest(seeded))).rejects.toThrow(/not available/)
    // And nothing was recorded: a session row for a launch that could not even
    // be attempted is a row the user has to wonder about.
    await expect(withoutPty.listSessions(seeded.workspaceId)).resolves.toHaveLength(0)
  })

  it("forwards keystrokes and geometry to the session's PTY", async () => {
    const seeded = await seedLaunchable()
    const session = await service.launchEmbedded(launchRequest(seeded))

    await service.writeToSession(session.sessionId, "npm test\r")
    await service.resizeSession(session.sessionId, 120, 40)
    await service.setSessionPaused(session.sessionId, true)

    expect(pty.writes).toEqual([{ sessionId: session.sessionId, data: "npm test\r" }])
    expect(pty.resizes).toEqual([{ sessionId: session.sessionId, cols: 120, rows: 40 }])
    expect(pty.paused).toEqual([{ sessionId: session.sessionId, paused: true }])
  })

  /**
   * `definition.env` is user configuration, not decoration: the schema carries
   * it, the repository persists it, and the launch must actually hand it to the
   * child. The APIWEAVE_* variables go in after it so a custom agent cannot
   * spoof the session's identity by reusing those keys.
   */
  it("merges the definition's env into the launch environment", async () => {
    const seeded = await seedLaunchable()
    agentRepository.upsertDefinition(seeded.workspaceId, {
      ...realExecutableAgent(),
      env: { MY_TOKEN: "secret-value", APIWEAVE_WORKSPACE_ID: "spoofed" },
    })

    await service.launchEmbedded(launchRequest(seeded))

    const spawned = pty.spawned[0]
    expect(spawned?.env["MY_TOKEN"]).toBe("secret-value")
    expect(spawned?.env["APIWEAVE_WORKSPACE_ID"]).toBe(seeded.workspaceId)
  })

  /**
   * A session id is as renderer-controlled as a scope id was. Resolving it to a
   * row *before* authorizing is what stops one workspace's terminal being typed
   * into from another — and an unknown id is missing rather than denied, which
   * is the existence-hiding the scope resolver already established.
   */
  it("refuses an unknown session rather than writing into the host", async () => {
    await expect(service.writeToSession("no-such-session", "rm -rf /\r")).rejects.toThrow(/not found/)
    await expect(service.resizeSession("no-such-session", 80, 24)).rejects.toThrow(/not found/)
    await expect(service.killSession("no-such-session")).rejects.toThrow(/not found/)
    await expect(service.authorizeSessionRead("no-such-session")).rejects.toThrow(/not found/)
    expect(pty.writes).toHaveLength(0)
    expect(pty.killed).toHaveLength(0)
  })

  /**
   * The kill deliberately leaves the row alone. The PTY host reports a real exit
   * for it, and `recordProcessEvent` is the only writer of that transition —
   * two writers for one event is how a session ends up with an exit code it
   * never had.
   */
  it("kills without pre-empting the exit the host will report", async () => {
    const seeded = await seedLaunchable()
    const session = await service.launchEmbedded(launchRequest(seeded))

    await service.killSession(session.sessionId)
    expect(pty.killed).toEqual([session.sessionId])
    const stillRunning = await service.listSessions(seeded.workspaceId)
    expect(stillRunning[0]?.status).toBe("running")

    service.recordProcessEvent({ kind: "agent.exited", sessionId: session.sessionId, exitCode: 130 })
    const settled = await service.listSessions(seeded.workspaceId)
    expect(settled[0]?.status).toBe("exited")
    expect(settled[0]?.exitCode).toBe(130)
    expect(settled[0]?.endedAt).not.toBeNull()
  })

  it("reports whether the host can still serve a session's output", async () => {
    const seeded = await seedLaunchable()
    const session = await service.launchEmbedded(launchRequest(seeded))

    await expect(service.authorizeSessionRead(session.sessionId)).resolves.toMatchObject({ attachable: true })
    pty.live = false
    await expect(service.authorizeSessionRead(session.sessionId)).resolves.toMatchObject({ attachable: false })
  })

  it("records a host failure against the session that was stranded by it", async () => {
    const seeded = await seedLaunchable()
    const session = await service.launchEmbedded(launchRequest(seeded))

    service.recordProcessEvent({
      kind: "agent.failed",
      sessionId: session.sessionId,
      message: "The terminal backend stopped unexpectedly (exit 1)",
    })

    const sessions = await service.listSessions(seeded.workspaceId)
    expect(sessions[0]?.status).toBe("failed")
    expect(sessions[0]?.error).toMatch(/stopped unexpectedly/)
  })

  /**
   * The host emits after a child is already gone: a teardown `agent.failed`
   * arrives behind each child's own exit, and a respawned host re-announces ids
   * it remembers. Either would overwrite the real exit code with a generic
   * message, or move a dead session back to running.
   */
  it("ignores an event that would move a finished session backwards", async () => {
    const seeded = await seedLaunchable()
    const session = await service.launchEmbedded(launchRequest(seeded))
    service.recordProcessEvent({ kind: "agent.exited", sessionId: session.sessionId, exitCode: 0 })

    service.recordProcessEvent({
      kind: "agent.failed",
      sessionId: session.sessionId,
      message: "The terminal backend stopped unexpectedly",
    })
    service.recordProcessEvent({ kind: "agent.started", sessionId: session.sessionId, pid: 777 })

    const sessions = await service.listSessions(seeded.workspaceId)
    expect(sessions[0]?.status).toBe("exited")
    expect(sessions[0]?.exitCode).toBe(0)
    expect(sessions[0]?.error).toBeNull()
    expect(sessions[0]?.endedAt).not.toBeNull()
  })

  it("shrugs at an event for a session that no longer exists", () => {
    expect(() =>
      service.recordProcessEvent({ kind: "agent.exited", sessionId: "no-such-session", exitCode: 0 }),
    ).not.toThrow()
  })
})

describe("AgentService — per-session MCP config", () => {
  /** A service whose MCP bridge is up, so the config file is actually written. */
  function wiredService(): AgentService {
    return new AgentService(
      agentRepository,
      workflows,
      collections,
      new LocalOwnerProvider(),
      new ScopeResolver({
        workspaceExists: (id) => workspaces.getById(id) !== undefined,
        environmentExists: () => false,
      }),
      {
        pickDirectory: pickDirectory as unknown as AgentEnvironment["pickDirectory"],
        getMcpConfig: () => ({ url: "http://127.0.0.1:47271", token: "secret-token", port: 47271 }),
        agentFilesDir,
        pty,
      },
    )
  }

  async function seedWired() {
    const seeded = seed()
    const wired = wiredService()
    await wired.saveCustomAgent(seeded.workspaceId, {
      ...realExecutableAgent(),
      mcpConfigArgs: ["--mcp-config", "{path}"],
    })
    pickDirectory.mockResolvedValue(tempDir)
    await wired.chooseLocalPath(seeded.workspaceId, { kind: "project", id: seeded.projectId })
    return { seeded, wired }
  }

  function launchRequest(projectId: string, workspaceId: string) {
    return {
      workspaceId,
      agentKey: "stub-runner",
      scope: { kind: "project" as const, id: projectId },
      cols: 100,
      rows: 30,
    }
  }

  function configFiles(): readonly string[] {
    return fs.existsSync(agentFilesDir)
      ? fs.readdirSync(agentFilesDir).filter((name) => name.startsWith("apiweave-mcp-"))
      : []
  }

  /**
   * The critical half of the fix. One fixed `apiweave.json` meant the second of
   * two concurrent launches rewrote the token the first agent had already been
   * handed — and the bridge mints a fresh token per run, so the first agent's
   * config could stop authenticating mid-session.
   */
  it("writes a distinct config per session so concurrent launches cannot collide", async () => {
    const { seeded, wired } = await seedWired()

    const first = await wired.launchEmbedded(launchRequest(seeded.projectId, seeded.workspaceId))
    const second = await wired.launchEmbedded(launchRequest(seeded.projectId, seeded.workspaceId))

    const paths = pty.spawned.map((request) => request.args[request.args.indexOf("--mcp-config") + 1])
    expect(paths[0]).not.toBe(paths[1])
    expect(paths[0]).toContain(first.sessionId)
    expect(paths[1]).toContain(second.sessionId)
    expect(configFiles()).toHaveLength(2)
  })

  /** A live bearer token must not outlive the session that was handed it. */
  it("deletes the config when an embedded session reaches a terminal state", async () => {
    const { seeded, wired } = await seedWired()
    const session = await wired.launchEmbedded(launchRequest(seeded.projectId, seeded.workspaceId))
    expect(configFiles()).toHaveLength(1)

    wired.recordProcessEvent({ kind: "agent.exited", sessionId: session.sessionId, exitCode: 0 })

    expect(configFiles()).toHaveLength(0)
  })

  it("deletes the config when the spawn never starts", async () => {
    const { seeded, wired } = await seedWired()
    pty.failWith = "the terminal backend did not start"

    await expect(wired.launchEmbedded(launchRequest(seeded.projectId, seeded.workspaceId))).rejects.toThrow()

    expect(configFiles()).toHaveLength(0)
  })

  /**
   * A crash leaves the token in userData with nothing tracking it. The sweep is
   * the only thing that reclaims those — and it must run before this process
   * writes one of its own, or it would delete a live session's config.
   */
  it("sweeps a previous run's leftovers on the first launch of this one", async () => {
    const { seeded, wired } = await seedWired()
    fs.mkdirSync(agentFilesDir, { recursive: true })
    fs.writeFileSync(path.join(agentFilesDir, "apiweave-mcp-crashed-run.json"), "{}")
    fs.writeFileSync(path.join(agentFilesDir, "launch-crashed-run.command"), "#!/bin/sh\n")

    const session = await wired.launchEmbedded(launchRequest(seeded.projectId, seeded.workspaceId))

    const remaining = fs.readdirSync(agentFilesDir)
    expect(remaining).not.toContain("apiweave-mcp-crashed-run.json")
    expect(remaining).not.toContain("launch-crashed-run.command")
    // The launch's own config survived the sweep it triggered.
    expect(remaining.some((name) => name.includes(session.sessionId))).toBe(true)
  })

  it("sweeps on demand for the composition root, and only once", async () => {
    const { seeded, wired } = await seedWired()
    fs.mkdirSync(agentFilesDir, { recursive: true })
    fs.writeFileSync(path.join(agentFilesDir, "apiweave-mcp-crashed-run.json"), "{}")

    expect(wired.sweepScratchFiles()).toBe(1)

    const session = await wired.launchEmbedded(launchRequest(seeded.projectId, seeded.workspaceId))
    expect(fs.readdirSync(agentFilesDir).some((name) => name.includes(session.sessionId))).toBe(true)
  })
})

describe("AgentService — stdin prompts", () => {
  async function seedStdinAgent() {
    const seeded = seed()
    await service.saveCustomAgent(seeded.workspaceId, {
      ...realExecutableAgent(),
      promptMode: "stdin",
      promptFlag: null,
    })
    pickDirectory.mockResolvedValue(tempDir)
    await service.chooseLocalPath(seeded.workspaceId, { kind: "project", id: seeded.projectId })
    return seeded
  }

  /**
   * `stdin` used to be accepted by the schema, stored by the repository, and
   * then silently discarded: the prompt reached neither argv nor the terminal,
   * so the agent came up having never been asked anything.
   */
  it("types the prompt into the PTY after the spawn, with the newline that submits it", async () => {
    const seeded = await seedStdinAgent()

    const session = await service.launchEmbedded({
      workspaceId: seeded.workspaceId,
      agentKey: "stub-runner",
      scope: { kind: "project", id: seeded.projectId },
      prompt: "why did the checkout workflow fail?",
      cols: 100,
      rows: 30,
    })

    expect(pty.writes).toEqual([
      { sessionId: session.sessionId, data: "why did the checkout workflow fail?\n" },
    ])
    // And it stays out of argv, where `stdin` mode says it does not belong.
    expect(pty.spawned[0]?.args).toEqual(["--version"])
  })

  it("writes nothing when a stdin agent is launched without a prompt", async () => {
    const seeded = await seedStdinAgent()
    await service.launchEmbedded({
      workspaceId: seeded.workspaceId,
      agentKey: "stub-runner",
      scope: { kind: "project", id: seeded.projectId },
      cols: 100,
      rows: 30,
    })

    expect(pty.writes).toHaveLength(0)
  })

  /**
   * There is no stdin to write to once the process has been handed to an
   * emulator. Launching anyway would open an agent that never received the
   * question, which reads as the agent ignoring the user.
   */
  it("refuses an external launch that would drop the prompt", async () => {
    const seeded = await seedStdinAgent()

    await expect(
      service.launchExternal({
        workspaceId: seeded.workspaceId,
        agentKey: "stub-runner",
        scope: { kind: "project", id: seeded.projectId },
        prompt: "why did the checkout workflow fail?",
      }),
    ).rejects.toThrow(/embedded terminal/)
    // Refused before anything was recorded — a session row for a launch that
    // never happened is a row the user has to wonder about.
    await expect(service.listSessions(seeded.workspaceId)).resolves.toHaveLength(0)
  })
})

describe("AgentService — external sessions and deletion", () => {
  async function seedExternal() {
    const seeded = seed()
    await service.saveCustomAgent(seeded.workspaceId, realExecutableAgent())
    pickDirectory.mockResolvedValue(tempDir)
    await service.chooseLocalPath(seeded.workspaceId, { kind: "project", id: seeded.projectId })
    return seeded
  }

  /** A session recorded by hand, because launching a real emulator in a test is not on. */
  function recordExternalSession(workspaceId: string, status: "running" | "exited") {
    return agentRepository.createSession({
      workspaceId,
      agentKey: "stub-runner",
      launchMode: "external",
      status,
      cwd: tempDir,
    })
  }

  /**
   * `pty.kill` matched nothing for an external session — the PTY host never
   * started it and the pid APIWeave spawned was the emulator's — so the caller
   * was told the agent had been stopped while it carried on running.
   */
  it("refuses to pretend it can kill a session running in the user's own terminal", async () => {
    const seeded = await seedExternal()
    const session = recordExternalSession(seeded.workspaceId, "running")

    await expect(service.killSession(session.sessionId)).rejects.toThrow(/your own terminal/)
    expect(pty.killed).toHaveLength(0)
  })

  it("still kills an embedded session", async () => {
    const seeded = await seedExternal()
    const session = await service.launchEmbedded({
      workspaceId: seeded.workspaceId,
      agentKey: "stub-runner",
      scope: { kind: "project", id: seeded.projectId },
      cols: 80,
      rows: 24,
    })

    await service.killSession(session.sessionId)
    expect(pty.killed).toEqual([session.sessionId])
  })

  /**
   * Deleting the row of a running process orphans that process: nothing is left
   * to attach to it, stop it, or record its exit. Stopping stays the user's
   * explicit second decision.
   */
  it("refuses to remove a session that is still live", async () => {
    const seeded = await seedExternal()
    const session = await service.launchEmbedded({
      workspaceId: seeded.workspaceId,
      agentKey: "stub-runner",
      scope: { kind: "project", id: seeded.projectId },
      cols: 80,
      rows: 24,
    })

    await expect(service.deleteSession(session.sessionId)).rejects.toThrow(/stop the session before removing it/)
    await expect(service.listSessions(seeded.workspaceId)).resolves.toHaveLength(1)
  })

  it("removes a finished embedded session and its scratch files", async () => {
    const seeded = await seedExternal()
    const session = agentRepository.createSession({
      workspaceId: seeded.workspaceId,
      agentKey: "stub-runner",
      launchMode: "embedded",
      status: "exited",
      cwd: tempDir,
    })
    fs.mkdirSync(agentFilesDir, { recursive: true })
    const config = path.join(agentFilesDir, `apiweave-mcp-${session.sessionId}.json`)
    const script = path.join(agentFilesDir, `launch-${session.sessionId}.command`)
    fs.writeFileSync(config, "{}")
    fs.writeFileSync(script, "#!/bin/sh\n")

    await service.deleteSession(session.sessionId)

    await expect(service.listSessions(seeded.workspaceId)).resolves.toHaveLength(0)
    expect(fs.existsSync(config)).toBe(false)
    expect(fs.existsSync(script)).toBe(false)
  })

  /**
   * An external row reads `exited` from the instant the emulator is spawned, so
   * it is removable while the agent it handed off is still running in the user's
   * terminal — still reading the MCP config that unlinking would take away.
   * Removing the row is a request to tidy a list, and it must not reach into a
   * live process to honour it; the startup sweep reclaims the file, which is
   * what `launchExternal` already relies on for the same reason.
   */
  it("leaves an external session's scratch files for the sweep", async () => {
    const seeded = await seedExternal()
    const session = recordExternalSession(seeded.workspaceId, "exited")
    fs.mkdirSync(agentFilesDir, { recursive: true })
    const config = path.join(agentFilesDir, `apiweave-mcp-${session.sessionId}.json`)
    fs.writeFileSync(config, "{}")

    await service.deleteSession(session.sessionId)

    await expect(service.listSessions(seeded.workspaceId)).resolves.toHaveLength(0)
    expect(fs.existsSync(config)).toBe(true)
  })

  it("refuses to remove a session it cannot find", async () => {
    await expect(service.deleteSession("no-such-session")).rejects.toThrow(/not found/)
  })
})

/**
 * Resuming: handing a finished conversation back to the CLI that owns it.
 *
 * The unit under test is the composition — which id is minted, when it is
 * stored, what argv it ends up in — because that is the part APIWeave decides.
 * Whether `--resume` is the right flag for a given CLI is a claim made by the
 * roster and checked in `shared/agents/__tests__`.
 */
describe("AgentService — resuming a session", () => {
  /** An agent APIWeave names the session for, the way `claude` and `gemini` do. */
  const ASSIGNING_AGENT: AgentDefinition = {
    ...CUSTOM_AGENT,
    agentKey: "assigner",
    name: "Assigning Agent",
    detectCmd: process.execPath,
    argv: ["--version"],
    promptMode: "none",
    promptFlag: null,
    mcpConfigArgs: [],
    sessionIdMode: "assign",
    newSessionArgs: ["--session-id", "{id}"],
    resumeArgs: ["--resume", "{id}"],
    sessionIdPattern: null,
  }

  /** An agent that mints its own and prints it, the way `opencode` and `codex` do. */
  const SCANNING_AGENT: AgentDefinition = {
    ...ASSIGNING_AGENT,
    agentKey: "scanner",
    name: "Scanning Agent",
    sessionIdMode: "scan",
    newSessionArgs: [],
    resumeArgs: ["--session", "{id}"],
    sessionIdPattern: "ses_[A-Za-z0-9]+",
  }

  async function seedWith(definition: AgentDefinition) {
    const seeded = seed()
    await service.saveCustomAgent(seeded.workspaceId, definition)
    pickDirectory.mockResolvedValue(tempDir)
    await service.chooseLocalPath(seeded.workspaceId, { kind: "project", id: seeded.projectId })
    return seeded
  }

  function request(seeded: ReturnType<typeof seed>, agentKey: string) {
    return {
      workspaceId: seeded.workspaceId,
      agentKey,
      scope: { kind: "project" as const, id: seeded.projectId },
      cols: 100,
      rows: 30,
    }
  }

  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

  /**
   * The point of `assign`: the row is resumable before the process has printed
   * anything, so even a session that dies during startup can be picked up.
   */
  it("mints an id, tells the agent, and stores it on the row", async () => {
    const seeded = await seedWith(ASSIGNING_AGENT)
    const session = await service.launchEmbedded(request(seeded, "assigner"))

    expect(session.agentSessionRef).toMatch(UUID)
    expect(pty.spawned[0]?.args).toContain("--session-id")
    expect(pty.spawned[0]?.args).toContain(session.agentSessionRef)
    // Nothing to watch for: the answer is already known.
    expect(pty.spawned[0]?.sessionIdPattern).toBeNull()
  })

  it("watches the output of an agent that mints its own id instead", async () => {
    const seeded = await seedWith(SCANNING_AGENT)
    const session = await service.launchEmbedded(request(seeded, "scanner"))

    expect(session.agentSessionRef ?? null).toBeNull()
    expect(pty.spawned[0]?.sessionIdPattern).toBe("ses_[A-Za-z0-9]+")
    expect(pty.spawned[0]?.args).not.toContain("--session-id")
  })

  /**
   * The row is the conversation, not the process that hosted it. Resuming the
   * same agent three times must not leave three near-identical rows in a list
   * that cannot show which is which.
   */
  it("runs the conversation again in the same row", async () => {
    const seeded = await seedWith(SCANNING_AGENT)
    const session = await service.launchEmbedded(request(seeded, "scanner"))

    service.recordProcessEvent({ kind: "agent.sessionRef", sessionId: session.sessionId, ref: "ses_abc123" })
    service.recordProcessEvent({ kind: "agent.exited", sessionId: session.sessionId, exitCode: 0 })

    const resumed = await service.resumeSession(session.sessionId, 120, 40)

    expect(resumed.sessionId).toBe(session.sessionId)
    expect(resumed.agentSessionRef).toBe("ses_abc123")
    expect(pty.spawned[1]?.args).toEqual(expect.arrayContaining(["--session", "ses_abc123"]))
    await expect(service.listSessions(seeded.workspaceId)).resolves.toHaveLength(1)
  })

  /**
   * The previous run's outcome has to go with it. A row showing `exit 1` and a
   * dead pid while a new process runs underneath describes neither of them.
   */
  it("clears the previous run's outcome and reports the new one", async () => {
    const seeded = await seedWith(SCANNING_AGENT)
    const session = await service.launchEmbedded(request(seeded, "scanner"))
    service.recordProcessEvent({ kind: "agent.sessionRef", sessionId: session.sessionId, ref: "ses_abc123" })
    service.recordProcessEvent({ kind: "agent.exited", sessionId: session.sessionId, exitCode: 1 })

    pty.nextPid = 5150
    const resumed = await service.resumeSession(session.sessionId, 120, 40)

    expect(resumed.status).toBe("running")
    expect(resumed.exitCode).toBeNull()
    expect(resumed.error).toBeNull()
    expect(resumed.endedAt).toBeNull()
    expect(resumed.pid).toBe(5150)
  })

  /** The identity of the conversation is exactly what a resume must not lose. */
  it("keeps the conversation id, title and folder across a resume", async () => {
    const seeded = await seedWith(SCANNING_AGENT)
    const session = await service.launchEmbedded(request(seeded, "scanner"))
    service.recordProcessEvent({ kind: "agent.sessionRef", sessionId: session.sessionId, ref: "ses_abc123" })
    service.recordProcessEvent({ kind: "agent.title", sessionId: session.sessionId, title: "Fix the auth test" })
    service.recordProcessEvent({ kind: "agent.exited", sessionId: session.sessionId, exitCode: 0 })

    const resumed = await service.resumeSession(session.sessionId, 120, 40)

    expect(resumed.agentSessionRef).toBe("ses_abc123")
    expect(resumed.title).toBe("Fix the auth test")
    expect(resumed.cwd).toBe(session.cwd)
  })

  it("refuses to resume a session that is still running", async () => {
    const seeded = await seedWith(SCANNING_AGENT)
    const session = await service.launchEmbedded(request(seeded, "scanner"))
    service.recordProcessEvent({ kind: "agent.sessionRef", sessionId: session.sessionId, ref: "ses_abc123" })

    await expect(service.resumeSession(session.sessionId, 100, 30)).rejects.toThrow(/still running/)
  })

  /**
   * The row was cleared before the spawn precisely so this can be recorded: a
   * row left at `exited` could not be moved to `failed`, because
   * `updateSession` pins terminal statuses against late events.
   */
  it("records a failed resume on the row it was clearing", async () => {
    const seeded = await seedWith(SCANNING_AGENT)
    const session = await service.launchEmbedded(request(seeded, "scanner"))
    service.recordProcessEvent({ kind: "agent.sessionRef", sessionId: session.sessionId, ref: "ses_abc123" })
    service.recordProcessEvent({ kind: "agent.exited", sessionId: session.sessionId, exitCode: 0 })

    pty.failWith = "the terminal backend did not start"
    await expect(service.resumeSession(session.sessionId, 100, 30)).rejects.toThrow(/did not start/)

    const rows = await service.listSessions(seeded.workspaceId)
    expect(rows[0]?.status).toBe("failed")
    expect(rows[0]?.error).toMatch(/did not start/)
    // Still resumable: the conversation is not what failed.
    expect(rows[0]?.agentSessionRef).toBe("ses_abc123")
  })

  /**
   * The ref routinely arrives *after* the exit — agents that mint their own id
   * print it in the banner they write on the way out. A guard that refused to
   * write to a terminal row would discard exactly the sessions worth resuming.
   */
  it("still records an id that arrives after the session has ended", async () => {
    const seeded = await seedWith(SCANNING_AGENT)
    const session = await service.launchEmbedded(request(seeded, "scanner"))

    service.recordProcessEvent({ kind: "agent.exited", sessionId: session.sessionId, exitCode: 0 })
    service.recordProcessEvent({ kind: "agent.sessionRef", sessionId: session.sessionId, ref: "ses_late" })

    const rows = await service.listSessions(seeded.workspaceId)
    expect(rows[0]?.agentSessionRef).toBe("ses_late")
    // And the exit it arrived behind is untouched.
    expect(rows[0]?.status).toBe("exited")
    expect(rows[0]?.exitCode).toBe(0)
  })

  /**
   * An agent asked about its own history prints other sessions' ids, and nothing
   * tells those apart from its own after the fact. First one wins.
   */
  it("keeps the first id it was given", async () => {
    const seeded = await seedWith(SCANNING_AGENT)
    const session = await service.launchEmbedded(request(seeded, "scanner"))

    service.recordProcessEvent({ kind: "agent.sessionRef", sessionId: session.sessionId, ref: "ses_first" })
    service.recordProcessEvent({ kind: "agent.sessionRef", sessionId: session.sessionId, ref: "ses_second" })

    const rows = await service.listSessions(seeded.workspaceId)
    expect(rows[0]?.agentSessionRef).toBe("ses_first")
  })

  it("stores the title the agent set, without disturbing the status", async () => {
    const seeded = await seedWith(ASSIGNING_AGENT)
    const session = await service.launchEmbedded(request(seeded, "assigner"))

    service.recordProcessEvent({ kind: "agent.title", sessionId: session.sessionId, title: "Fix the auth test" })

    const rows = await service.listSessions(seeded.workspaceId)
    expect(rows[0]?.title).toBe("Fix the auth test")
    expect(rows[0]?.status).toBe("running")
  })

  it("refuses to resume a session that never recorded an id", async () => {
    const seeded = await seedWith(SCANNING_AGENT)
    const session = await service.launchEmbedded(request(seeded, "scanner"))
    service.recordProcessEvent({ kind: "agent.exited", sessionId: session.sessionId, exitCode: 0 })

    await expect(service.resumeSession(session.sessionId, 100, 30)).rejects.toThrow(/no conversation id/)
  })

  it("refuses to resume an agent that cannot resume", async () => {
    const seeded = seed()
    await service.saveCustomAgent(seeded.workspaceId, {
      ...ASSIGNING_AGENT,
      agentKey: "no-resume",
      sessionIdMode: "none",
      newSessionArgs: [],
      resumeArgs: [],
    })
    pickDirectory.mockResolvedValue(tempDir)
    await service.chooseLocalPath(seeded.workspaceId, { kind: "project", id: seeded.projectId })
    const session = agentRepository.createSession({
      workspaceId: seeded.workspaceId,
      agentKey: "no-resume",
      launchMode: "embedded",
      status: "exited",
      cwd: tempDir,
      scopeKind: "project",
      scopeId: seeded.projectId,
      agentSessionRef: "ses_orphan",
    })

    await expect(service.resumeSession(session.sessionId, 100, 30)).rejects.toThrow(/does not support resuming/)
  })

  it("refuses to resume a session it cannot find", async () => {
    await expect(service.resumeSession("no-such-session", 100, 30)).rejects.toThrow(/not found/)
  })

  /**
   * An agent that assigns its own ids is handed the *stored* one on a resume,
   * not a fresh one — otherwise every resume would silently start a new
   * conversation while claiming to continue the old.
   */
  it("reuses the stored id rather than minting another when resuming", async () => {
    const seeded = await seedWith(ASSIGNING_AGENT)
    const first = await service.launchEmbedded(request(seeded, "assigner"))
    service.recordProcessEvent({ kind: "agent.exited", sessionId: first.sessionId, exitCode: 0 })

    const resumed = await service.resumeSession(first.sessionId, 100, 30)

    expect(resumed.agentSessionRef).toBe(first.agentSessionRef)
    expect(pty.spawned[1]?.args).toEqual(expect.arrayContaining(["--resume", first.agentSessionRef ?? ""]))
    expect(pty.spawned[1]?.args).not.toContain("--session-id")
  })

  /**
   * Resuming twice is ordinary — an agent worked, stopped, was picked up, worked
   * again. Each one has to land in the same row, or the second resume
   * reintroduces exactly the duplication the first was fixed to avoid.
   */
  it("stays in one row across repeated resumes", async () => {
    const seeded = await seedWith(ASSIGNING_AGENT)
    const first = await service.launchEmbedded(request(seeded, "assigner"))

    for (let round = 0; round < 3; round++) {
      service.recordProcessEvent({ kind: "agent.exited", sessionId: first.sessionId, exitCode: 0 })
      await service.resumeSession(first.sessionId, 100, 30)
    }

    const rows = await service.listSessions(seeded.workspaceId)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.sessionId).toBe(first.sessionId)
    expect(rows[0]?.agentSessionRef).toBe(first.agentSessionRef)
    expect(pty.spawned).toHaveLength(4)
  })
})
