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
  const environment: AgentEnvironment = {
    pickDirectory: pickDirectory as unknown as AgentEnvironment["pickDirectory"],
    getMcpConfig: () => null,
    agentFilesDir: "/tmp/apiweave-agent-files",
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
        agentFilesDir: path.join(tempDir, "agent-files"),
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
        agentFilesDir: "/tmp/apiweave-agent-files",
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
})
