import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { initDatabase } from "../../db"
import type { InitializedDatabase } from "../../db"
import { AgentRepository, WorkspaceRepository } from "../index"

let db: InitializedDatabase
let workspaces: WorkspaceRepository
let agents: AgentRepository

beforeEach(() => {
  db = initDatabase({ databasePath: ":memory:" })
  workspaces = new WorkspaceRepository(db.kvStore)
  agents = new AgentRepository(db.kvStore)
})

afterEach(() => {
  db.close()
})

function seedWorkspace(): string {
  return workspaces.create({ name: "Local", slug: `local-${Math.floor(Math.random() * 1e9)}` }).workspaceId
}

function createSession(workspaceId: string, status: "starting" | "running" | "exited" | "failed" = "running") {
  return agents.createSession({
    workspaceId,
    agentKey: "claude",
    launchMode: "embedded",
    status,
    cwd: "/src/shop-api",
  })
}

describe("AgentRepository — default agent key", () => {
  /**
   * The key lives in `app_settings` with no FK to the definition it names, so
   * nothing in SQLite clears it when that definition goes.
   */
  it("clears the stored default so the roster can fall back", () => {
    const workspaceId = seedWorkspace()
    agents.setDefaultAgentKey(workspaceId, "my-agent")
    expect(agents.getDefaultAgentKey(workspaceId)).toBe("my-agent")

    expect(agents.clearDefaultAgentKey(workspaceId)).toBe(true)
    expect(agents.getDefaultAgentKey(workspaceId)).toBeUndefined()
    // Clearing a key that was never set is not an error, just nothing done.
    expect(agents.clearDefaultAgentKey(workspaceId)).toBe(false)
  })

  it("keys the default per workspace", () => {
    const first = seedWorkspace()
    const second = seedWorkspace()
    agents.setDefaultAgentKey(first, "aider")
    agents.setDefaultAgentKey(second, "codex")

    agents.clearDefaultAgentKey(first)
    expect(agents.getDefaultAgentKey(second)).toBe("codex")
  })
})

describe("AgentRepository — session state machine", () => {
  it("stamps endedAt on the terminal transition and keeps the first one", async () => {
    const workspaceId = seedWorkspace()
    const session = createSession(workspaceId)
    expect(session.endedAt).toBeNull()

    const exited = agents.updateSession(session.sessionId, { status: "exited", exitCode: 0 })
    expect(exited?.endedAt).not.toBeNull()

    await new Promise((resolve) => setTimeout(resolve, 5))
    const again = agents.updateSession(session.sessionId, { status: "exited", exitCode: 0 })
    expect(again?.endedAt).toBe(exited?.endedAt)
  })

  /**
   * The host can emit after a child has already been recorded as gone — a
   * teardown `agent.failed` arrives behind each child's own exit, and a
   * respawned host re-announces ids it remembers. Letting either through turns
   * a finished session back into a running one that nothing will ever end.
   */
  it("refuses to move a session out of a terminal status", () => {
    const workspaceId = seedWorkspace()
    const session = createSession(workspaceId)
    agents.updateSession(session.sessionId, { status: "exited", exitCode: 130 })

    const resurrected = agents.updateSession(session.sessionId, { status: "running", pid: 99 })
    expect(resurrected?.status).toBe("exited")
    expect(resurrected?.exitCode).toBe(130)
    expect(resurrected?.endedAt).not.toBeNull()

    expect(agents.updateSession(session.sessionId, { status: "failed", error: "host died" })?.status).toBe("exited")
  })

  /**
   * The previous form wrote `endedAt = NULL` for any non-terminal status, so a
   * patch that only touched the pid on an ended row produced a session with
   * both an exit code and no end time.
   */
  it("never nulls an endedAt that is already set", () => {
    const workspaceId = seedWorkspace()
    const session = createSession(workspaceId)
    const ended = agents.updateSession(session.sessionId, { status: "failed", error: "spawn failed" })

    const patched = agents.updateSession(session.sessionId, { pid: 1234 })
    expect(patched?.endedAt).toBe(ended?.endedAt)
    expect(patched?.status).toBe("failed")
  })

  it("leaves a live session patchable", () => {
    const workspaceId = seedWorkspace()
    const session = createSession(workspaceId, "starting")

    const running = agents.updateSession(session.sessionId, { status: "running", pid: 4242 })
    expect(running?.status).toBe("running")
    expect(running?.pid).toBe(4242)
    expect(running?.endedAt).toBeNull()
  })
})

describe("AgentRepository — session pruning", () => {
  /**
   * `listSessions` reads at most 50, so an append-only table stays invisible
   * until the database file is the symptom.
   */
  it("keeps a bounded history of terminal sessions", () => {
    const workspaceId = seedWorkspace()
    for (let index = 0; index < 12; index += 1) {
      const session = createSession(workspaceId)
      agents.updateSession(session.sessionId, { status: "exited", exitCode: 0 })
      agents.pruneSessions(workspaceId, 5)
    }

    expect(agents.listSessions(workspaceId, 1000)).toHaveLength(5)
  })

  it("prunes on create, without being asked", () => {
    const workspaceId = seedWorkspace()
    for (let index = 0; index < 260; index += 1) {
      const session = createSession(workspaceId)
      agents.updateSession(session.sessionId, { status: "exited", exitCode: 0 })
    }

    const remaining = agents.listSessions(workspaceId, 1000)
    expect(remaining.length).toBeLessThanOrEqual(200)
    expect(remaining.length).toBeGreaterThan(0)
  })

  /** A running session is not history, however far down the list it has sunk. */
  it("never prunes a session that is still live", () => {
    const workspaceId = seedWorkspace()
    const live = createSession(workspaceId, "running")
    for (let index = 0; index < 10; index += 1) {
      const session = createSession(workspaceId)
      agents.updateSession(session.sessionId, { status: "exited", exitCode: 0 })
    }

    expect(agents.pruneSessions(workspaceId, 2)).toBeGreaterThan(0)
    expect(agents.getSession(live.sessionId)?.status).toBe("running")
  })

  it("prunes only inside the workspace it was asked about", () => {
    const first = seedWorkspace()
    const second = seedWorkspace()
    for (let index = 0; index < 4; index += 1) {
      agents.updateSession(createSession(first).sessionId, { status: "exited", exitCode: 0 })
      agents.updateSession(createSession(second).sessionId, { status: "exited", exitCode: 0 })
    }

    agents.pruneSessions(first, 1)
    expect(agents.listSessions(first, 1000)).toHaveLength(1)
    expect(agents.listSessions(second, 1000)).toHaveLength(4)
  })
})

describe("AgentRepository — deleteSession", () => {
  it("removes the row and reports whether there was one", () => {
    const workspaceId = seedWorkspace()
    const session = createSession(workspaceId)

    expect(agents.deleteSession(session.sessionId)).toBe(true)
    expect(agents.getSession(session.sessionId)).toBeUndefined()
    expect(agents.deleteSession(session.sessionId)).toBe(false)
  })
})

describe("AgentRepository — row decoding", () => {
  /**
   * The `CHECK` constraint only binds the schema the file was created with. A
   * database restored from an older build can hold a status outside the union,
   * and a bare `as` cast used to hand that straight to a renderer whose switch
   * is exhaustive over four cases.
   */
  /**
   * `ignore_check_constraints` reproduces what a real out-of-union value looks
   * like: a `CHECK` binds only the schema the file was created with, so a
   * database written by an older build, hand-edited, or restored from another
   * machine reaches the reader with the constraint never having run.
   */
  function corrupt(column: string, value: string, sessionId: string): void {
    db.kvStore.exec("PRAGMA ignore_check_constraints = ON")
    db.kvStore.set(`UPDATE agent_sessions SET ${column} = ? WHERE id = ?`, [value, sessionId])
    db.kvStore.exec("PRAGMA ignore_check_constraints = OFF")
  }

  it("throws on a status outside the union rather than casting it through", () => {
    const workspaceId = seedWorkspace()
    const session = createSession(workspaceId)
    corrupt("status", "zombie", session.sessionId)

    expect(() => agents.getSession(session.sessionId)).toThrow()
  })

  it("throws on a launch_mode outside the union", () => {
    const workspaceId = seedWorkspace()
    const session = createSession(workspaceId)
    corrupt("launch_mode", "telepathy", session.sessionId)

    expect(() => agents.getSession(session.sessionId)).toThrow()
  })

  it("throws on a scope_kind outside the union", () => {
    const workspaceId = seedWorkspace()
    const session = createSession(workspaceId)
    corrupt("scope_kind", "galaxy", session.sessionId)

    expect(() => agents.getSession(session.sessionId)).toThrow(/scope_kind/)
  })

  it("accepts a null scope_kind, which is a session launched without one", () => {
    const workspaceId = seedWorkspace()
    const session = createSession(workspaceId)
    expect(session.scopeKind).toBeNull()
  })
})

describe("AgentRepository — the conversation behind a session", () => {
  it("stores the agent's own conversation id at insert", () => {
    const workspaceId = seedWorkspace()
    const session = agents.createSession({
      workspaceId,
      agentKey: "claude",
      launchMode: "embedded",
      status: "starting",
      cwd: "/src/shop-api",
      agentSessionRef: "123e4567-e89b-12d3-a456-426614174000",
    })

    expect(session.agentSessionRef).toBe("123e4567-e89b-12d3-a456-426614174000")
    expect(agents.getSession(session.sessionId)?.agentSessionRef).toBe("123e4567-e89b-12d3-a456-426614174000")
  })

  it("leaves both fields null for a session that never reported one", () => {
    const workspaceId = seedWorkspace()
    const session = createSession(workspaceId)

    expect(session.agentSessionRef).toBeNull()
    expect(session.title).toBeNull()
  })

  /**
   * The case the whole feature turns on. An agent that mints its own id prints
   * it in the banner it writes as it exits, so the ref arrives for a row that
   * has already reached a terminal status — and `updateSession` deliberately
   * pins status against exactly that kind of late write. The pin must apply to
   * `status`, and not to the metadata riding alongside it.
   */
  it("accepts a conversation id and a title after the session has ended", () => {
    const workspaceId = seedWorkspace()
    const session = createSession(workspaceId)
    agents.updateSession(session.sessionId, { status: "exited", exitCode: 0 })

    const updated = agents.updateSession(session.sessionId, {
      agentSessionRef: "ses_late",
      title: "Fix the auth test",
    })

    expect(updated?.agentSessionRef).toBe("ses_late")
    expect(updated?.title).toBe("Fix the auth test")
    // And none of it disturbed the ending it arrived behind.
    expect(updated?.status).toBe("exited")
    expect(updated?.exitCode).toBe(0)
    expect(updated?.endedAt).not.toBeNull()
  })

  it("leaves an untouched field alone when the other is patched", () => {
    const workspaceId = seedWorkspace()
    const session = createSession(workspaceId)
    agents.updateSession(session.sessionId, { agentSessionRef: "ses_keep" })

    const updated = agents.updateSession(session.sessionId, { title: "Something else" })

    expect(updated?.agentSessionRef).toBe("ses_keep")
    expect(updated?.title).toBe("Something else")
  })

  /**
   * Two rows sharing a ref is the *relationship*, not a collision: resuming
   * continues the same conversation, so the new row and the one it resumed from
   * necessarily point at the same id. A unique constraint here would forbid the
   * feature.
   */
  it("lets two sessions share a conversation id, which is what a resume is", () => {
    const workspaceId = seedWorkspace()
    const first = agents.createSession({
      workspaceId,
      agentKey: "claude",
      launchMode: "embedded",
      status: "exited",
      cwd: "/src/shop-api",
      agentSessionRef: "ses_shared",
    })
    const second = agents.createSession({
      workspaceId,
      agentKey: "claude",
      launchMode: "embedded",
      status: "running",
      cwd: "/src/shop-api",
      agentSessionRef: "ses_shared",
    })

    expect(first.sessionId).not.toBe(second.sessionId)
    expect(agents.listSessions(workspaceId).map((row) => row.agentSessionRef)).toEqual([
      "ses_shared",
      "ses_shared",
    ])
  })
})

/**
 * The behavioural half of a definition lives in one `options_json` blob, which
 * is what lets a field be added without a migration — and is also how a field
 * gets silently dropped, since every one of them is named twice: once on the way
 * in and once on the way out.
 */
describe("AgentRepository — definition options", () => {
  it("round-trips the briefing flag through the options blob", () => {
    const workspaceId = seedWorkspace()
    agents.upsertDefinition(workspaceId, {
      agentKey: "briefed",
      name: "Briefed",
      detectCmd: "briefed",
      argv: [],
      expectedProcess: null,
      env: {},
      promptMode: "none",
      promptFlag: null,
      mcpConfigArgs: [],
      briefingArgs: ["--append-system-prompt-file", "{path}"],
      sessionIdMode: "none",
      newSessionArgs: [],
      resumeArgs: [],
      sessionIdPattern: null,
      unsupportedPlatforms: [],
      installUrl: null,
    })

    expect(agents.getDefinition(workspaceId, "briefed")?.briefingArgs).toEqual([
      "--append-system-prompt-file",
      "{path}",
    ])
  })

  /**
   * A row written before the briefing existed has no honest value for it, and
   * the fallback is what keeps that agent launching — as one that simply gets no
   * briefing, which is what it was when it was written.
   */
  it("launches a definition stored before the field existed", () => {
    const workspaceId = seedWorkspace()
    agents.upsertDefinition(workspaceId, {
      agentKey: "legacy",
      name: "Legacy",
      detectCmd: "legacy",
      argv: [],
      expectedProcess: null,
      env: {},
      promptMode: "none",
      promptFlag: null,
      mcpConfigArgs: [],
      briefingArgs: [],
      sessionIdMode: "none",
      newSessionArgs: [],
      resumeArgs: [],
      sessionIdPattern: null,
      unsupportedPlatforms: [],
      installUrl: null,
    })
    // The blob as an older build would have written it: no `briefingArgs` key.
    db.kvStore.set("UPDATE agent_definitions SET options_json = ? WHERE workspace_id = ? AND agent_key = ?", [
      JSON.stringify({ promptMode: "none", mcpConfigArgs: [] }),
      workspaceId,
      "legacy",
    ])

    expect(agents.getDefinition(workspaceId, "legacy")?.briefingArgs).toEqual([])
  })

  /** The launcher-config carrier round-trips like the briefing flag does. */
  it("round-trips the config carrier through the options blob", () => {
    const workspaceId = seedWorkspace()
    agents.upsertDefinition(workspaceId, {
      agentKey: "carrier",
      name: "Carrier",
      detectCmd: "carrier",
      argv: [],
      expectedProcess: null,
      env: {},
      promptMode: "none",
      promptFlag: null,
      mcpConfigArgs: [],
      briefingArgs: [],
      configEnv: { OPENCODE_CONFIG: "{path}" },
      sessionIdMode: "none",
      newSessionArgs: [],
      resumeArgs: [],
      sessionIdPattern: null,
      unsupportedPlatforms: [],
      installUrl: null,
    })

    expect(agents.getDefinition(workspaceId, "carrier")?.configEnv).toEqual({ OPENCODE_CONFIG: "{path}" })
  })

  /**
   * A row written before the carrier existed launches as it did when it was
   * written: with no config file and no variable naming one.
   */
  it("launches a definition stored before the carrier existed", () => {
    const workspaceId = seedWorkspace()
    agents.upsertDefinition(workspaceId, {
      agentKey: "legacy-carrier",
      name: "Legacy Carrier",
      detectCmd: "legacy-carrier",
      argv: [],
      expectedProcess: null,
      env: {},
      promptMode: "none",
      promptFlag: null,
      mcpConfigArgs: [],
      briefingArgs: [],
      sessionIdMode: "none",
      newSessionArgs: [],
      resumeArgs: [],
      sessionIdPattern: null,
      unsupportedPlatforms: [],
      installUrl: null,
    })
    // The blob as an older build would have written it: no `configEnv` key.
    db.kvStore.set("UPDATE agent_definitions SET options_json = ? WHERE workspace_id = ? AND agent_key = ?", [
      JSON.stringify({ promptMode: "none", mcpConfigArgs: [] }),
      workspaceId,
      "legacy-carrier",
    ])

    expect(agents.getDefinition(workspaceId, "legacy-carrier")?.configEnv).toEqual({})
  })

  /** The MCP env carrier and file format round-trip like the others. */
  it("round-trips the mcp env carrier and file format", () => {
    const workspaceId = seedWorkspace()
    agents.upsertDefinition(workspaceId, {
      agentKey: "env-carrier",
      name: "Env Carrier",
      detectCmd: "env-carrier",
      argv: [],
      expectedProcess: null,
      env: {},
      promptMode: "none",
      promptFlag: null,
      mcpConfigArgs: [],
      mcpConfigEnv: { GEMINI_CLI_SYSTEM_SETTINGS_PATH: "{path}", APIWEAVE_MCP_TOKEN: "{token}" },
      mcpConfigFormat: "qwen",
      briefingArgs: [],
      configEnv: {},
      sessionIdMode: "none",
      newSessionArgs: [],
      resumeArgs: [],
      sessionIdPattern: null,
      unsupportedPlatforms: [],
      installUrl: null,
    })

    const stored = agents.getDefinition(workspaceId, "env-carrier")
    expect(stored?.mcpConfigEnv).toEqual({ GEMINI_CLI_SYSTEM_SETTINGS_PATH: "{path}", APIWEAVE_MCP_TOKEN: "{token}" })
    expect(stored?.mcpConfigFormat).toBe("qwen")
  })

  /**
   * A row written before either field existed launches as it did when written:
   * with no MCP variables, in the one file shape that existed then.
   */
  it("launches a definition stored before the mcp env fields existed", () => {
    const workspaceId = seedWorkspace()
    agents.upsertDefinition(workspaceId, {
      agentKey: "legacy-mcp-env",
      name: "Legacy Mcp Env",
      detectCmd: "legacy-mcp-env",
      argv: [],
      expectedProcess: null,
      env: {},
      promptMode: "none",
      promptFlag: null,
      mcpConfigArgs: [],
      briefingArgs: [],
      sessionIdMode: "none",
      newSessionArgs: [],
      resumeArgs: [],
      sessionIdPattern: null,
      unsupportedPlatforms: [],
      installUrl: null,
    })
    // The blob as an older build would have written it: neither key present.
    db.kvStore.set("UPDATE agent_definitions SET options_json = ? WHERE workspace_id = ? AND agent_key = ?", [
      JSON.stringify({ promptMode: "none", mcpConfigArgs: [] }),
      workspaceId,
      "legacy-mcp-env",
    ])

    const stored = agents.getDefinition(workspaceId, "legacy-mcp-env")
    expect(stored?.mcpConfigEnv).toEqual({})
    expect(stored?.mcpConfigFormat).toBe("claude")
  })
})
