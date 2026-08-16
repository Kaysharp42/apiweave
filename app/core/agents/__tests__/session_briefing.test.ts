import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  buildSessionBriefing,
  deleteSessionBriefing,
  renderBriefingArgs,
  sessionBriefingFilename,
  sweepSessionBriefings,
  writeSessionBriefing,
  type AgentBriefingContext,
} from "../session_briefing"

let scratchDir: string

beforeEach(() => {
  scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), "apiweave-briefing-"))
})

afterEach(() => {
  fs.rmSync(scratchDir, { recursive: true, force: true })
})

function context(overrides: Partial<AgentBriefingContext> = {}): AgentBriefingContext {
  return {
    workspaceId: "ws-1",
    scopeKind: "workflow",
    scopeId: "wf-42",
    scopeName: "Checkout smoke",
    cwd: "F:\\Work\\test-backend",
    mcpWired: true,
    ...overrides,
  }
}

describe("session briefing text", () => {
  /**
   * The three facts the user would otherwise type every single time: which
   * workflow, which workspace, which folder.
   */
  it("names the workflow, the workspace and the folder", () => {
    const text = buildSessionBriefing(context())

    expect(text).toContain("Checkout smoke")
    expect(text).toContain("wf-42")
    expect(text).toContain("ws-1")
    expect(text).toContain("F:\\Work\\test-backend")
  })

  /** A scope is one of two kinds, and the wrong noun sends the agent looking for the wrong thing. */
  it("describes a project scope as a project", () => {
    const text = buildSessionBriefing(context({ scopeKind: "project", scopeId: "col-7", scopeName: "Shop API" }))

    expect(text).toContain("Project: \"Shop API\" (col-7)")
    expect(text).toContain("APIWEAVE_PROJECT_ID")
    expect(text).not.toContain("APIWEAVE_WORKFLOW_ID")
  })

  /** A row can lose its name; an id alone is still enough to act on. */
  it("falls back to the bare id when the scope has no name", () => {
    const text = buildSessionBriefing(context({ scopeName: null }))

    expect(text).toContain("wf-42")
    expect(text).not.toContain('""')
  })

  /**
   * The single most useful sentence in the file. Every agent launched here
   * starts in a git repository, and a workflow is not in it — without this the
   * first thing an agent does is grep for one.
   */
  it("says the workflow is not in the folder", () => {
    const text = buildSessionBriefing(context())

    expect(text).toContain("not in this folder")
  })

  /**
   * Telling an agent to reach for tools it was not given is worse than telling
   * it there are none: it spends the session hunting for them.
   */
  it("says so when the session has no MCP server", () => {
    const wired = buildSessionBriefing(context())
    const bare = buildSessionBriefing(context({ mcpWired: false }))

    expect(wired).toContain("`apiweave` MCP server is already connected")
    expect(bare).not.toContain("already connected")
    expect(bare).toContain("without APIWeave's MCP server")
  })

  /** The pointer that makes the rest of the documentation findable at all. */
  it("points at the start-here guide", () => {
    expect(buildSessionBriefing(context())).toContain("apiweave://guide/start-here")
  })
})

describe("session briefing files", () => {
  it("writes the briefing under a name owned by one session", () => {
    const filePath = writeSessionBriefing(scratchDir, "session-1", "hello")

    expect(path.basename(filePath)).toBe(sessionBriefingFilename("session-1"))
    expect(fs.readFileSync(filePath, "utf8")).toBe("hello")
  })

  /**
   * The id is generated, never renderer-supplied — but it becomes a filename,
   * and a separator in one would write outside the scratch directory.
   */
  it("keeps a path separator out of the filename", () => {
    const name = sessionBriefingFilename("../../escape")

    expect(name).not.toContain("/")
    expect(name).not.toContain("\\")
    expect(name).not.toContain("..")
  })

  it("deletes one session's briefing and reports a missing one honestly", () => {
    writeSessionBriefing(scratchDir, "session-1", "hello")

    expect(deleteSessionBriefing(scratchDir, "session-1")).toBe(true)
    expect(fs.existsSync(path.join(scratchDir, sessionBriefingFilename("session-1")))).toBe(false)
  })

  /**
   * The startup sweep. A crash leaves a briefing per session with nothing
   * tracking it, and only files this module wrote are its to remove.
   */
  it("sweeps briefings and nothing else in the directory", () => {
    writeSessionBriefing(scratchDir, "session-1", "one")
    writeSessionBriefing(scratchDir, "session-2", "two")
    fs.writeFileSync(path.join(scratchDir, "apiweave-mcp-session-1.json"), "{}")

    expect(sweepSessionBriefings(scratchDir)).toBe(2)
    expect(fs.readdirSync(scratchDir)).toEqual(["apiweave-mcp-session-1.json"])
  })

  it("survives a scratch directory that does not exist", () => {
    expect(sweepSessionBriefings(path.join(scratchDir, "nope"))).toBe(0)
  })
})

describe("briefing argv", () => {
  it("fills the path into its own argument and into a joined one", () => {
    expect(renderBriefingArgs(["--append-system-prompt-file", "{path}"], "C:\\brief.md")).toEqual([
      "--append-system-prompt-file",
      "C:\\brief.md",
    ])
    expect(renderBriefingArgs(["--instructions={path}"], "C:\\brief.md")).toEqual(["--instructions=C:\\brief.md"])
  })

  it("renders nothing for an agent that names no flag", () => {
    expect(renderBriefingArgs([], "C:\\brief.md")).toEqual([])
  })
})
