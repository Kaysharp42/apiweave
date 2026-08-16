import { describe, expect, it } from "vitest"
import { AgentDefinitionSchema } from "../../zod-schemas/AgentDefinitionSchema"
import { BUILTIN_AGENTS, findBuiltinAgent } from "../builtin-agents"

/**
 * The roster is data, and data about *other people's* command lines: every flag
 * in it is a claim about a CLI this repository does not build, cannot import,
 * and mostly cannot run in CI. The compiler checks the shape and nothing else,
 * so these tests check the claims that have a right answer independent of any
 * installed binary — that the templates are well-formed, that the modes and the
 * flags agree, and that each shipped pattern matches the literal line its agent
 * actually prints.
 *
 * What they cannot check is whether the flag exists. That is what the "confirmed
 * against ..." comment on each entry is for, and why an unverified agent ships
 * with an empty `resumeArgs` rather than a plausible guess.
 */

function pattern(agentKey: string): RegExp {
  const source = findBuiltinAgent(agentKey)?.sessionIdPattern
  if (source === null || source === undefined) {
    throw new Error(`${agentKey} has no sessionIdPattern`)
  }
  return new RegExp(source)
}

/** What the host does with a match: capture group 1, else the whole match. */
function scan(agentKey: string, output: string): string | undefined {
  const found = pattern(agentKey).exec(output)
  return found === null ? undefined : (found[1] ?? found[0])
}

describe("built-in agent definitions", () => {
  it("all parse as definitions", () => {
    for (const agent of BUILTIN_AGENTS) {
      expect(() => AgentDefinitionSchema.parse(agent)).not.toThrow()
    }
  })

  /**
   * `{id}` is the only substitution `fillTemplate` performs. A template that
   * misspelled it would pass every type check and then hand the agent the
   * literal string `{sessionId}` as its session id — a launch that fails, or
   * worse, silently starts a conversation nobody can find again.
   */
  it("spells the id placeholder the one way the launcher substitutes", () => {
    for (const agent of BUILTIN_AGENTS) {
      for (const template of [...agent.newSessionArgs, ...agent.resumeArgs]) {
        const braced = template.match(/\{[a-zA-Z]+\}/g) ?? []
        for (const found of braced) {
          expect(found, `${agent.agentKey}: ${template}`).toBe("{id}")
        }
      }
    }
  })

  it("puts the placeholder somewhere in any non-empty template", () => {
    for (const agent of BUILTIN_AGENTS) {
      if (agent.resumeArgs.length > 0) {
        expect(agent.resumeArgs.join(" "), agent.agentKey).toContain("{id}")
      }
      if (agent.newSessionArgs.length > 0) {
        expect(agent.newSessionArgs.join(" "), agent.agentKey).toContain("{id}")
      }
    }
  })

  /**
   * The two halves of `assign` have to agree. A definition claiming to assign an
   * id while naming no flag to assign it with would store a ref the agent was
   * never told about — producing a row that offers Resume and reopens a
   * conversation that does not exist.
   */
  it("gives every assign-mode agent something to assign with", () => {
    for (const agent of BUILTIN_AGENTS) {
      if (agent.sessionIdMode !== "assign") continue
      expect(agent.newSessionArgs.length, agent.agentKey).toBeGreaterThan(0)
      expect(agent.resumeArgs.length, agent.agentKey).toBeGreaterThan(0)
    }
  })

  it("gives every scan-mode agent a pattern and a way to use what it finds", () => {
    for (const agent of BUILTIN_AGENTS) {
      if (agent.sessionIdMode !== "scan") continue
      expect(agent.sessionIdPattern, agent.agentKey).toBeTruthy()
      expect(agent.resumeArgs.length, agent.agentKey).toBeGreaterThan(0)
    }
  })

  /** An uncompilable pattern is inert by design, but shipping one is a bug. */
  it("ships only patterns that compile", () => {
    for (const agent of BUILTIN_AGENTS) {
      const source = agent.sessionIdPattern
      if (source === null || source === undefined) continue
      expect(() => new RegExp(source), agent.agentKey).not.toThrow()
    }
  })

  /**
   * An agent that mints its own id but has no `{id}` flag to be told one must
   * never be handed `newSessionArgs`, and `assign` must never be paired with a
   * pattern — the host would scan every byte of a long session looking for
   * something already on the row.
   */
  it("does not both assign and scan", () => {
    for (const agent of BUILTIN_AGENTS) {
      if (agent.sessionIdMode === "assign") {
        expect(agent.sessionIdPattern ?? null, agent.agentKey).toBeNull()
      }
      if (agent.sessionIdMode === "scan") {
        expect(agent.newSessionArgs, agent.agentKey).toEqual([])
      }
    }
  })
})

describe("session id patterns, against the output they were written for", () => {
  /**
   * Codex prints this on a clean exit. Its id is a bare UUID, so the pattern has
   * to anchor on the words around it — a naked UUID pattern would match the
   * first one anywhere in the session's output, quite possibly out of a file the
   * agent was reading.
   */
  it("reads codex's resume line", () => {
    expect(
      scan("codex", "To continue this session, run codex resume 123e4567-e89b-12d3-a456-426614174000\r\n"),
    ).toBe("123e4567-e89b-12d3-a456-426614174000")
  })

  it("reads codex's fatal-exit line, which is worded differently", () => {
    expect(scan("codex", "Session ID: 123e4567-e89b-12d3-a456-426614174000\r\n")).toBe(
      "123e4567-e89b-12d3-a456-426614174000",
    )
  })

  /**
   * The reason the anchor is not optional. This is a UUID in ordinary output —
   * an agent reading a fixture, printing a log line, quoting a test — and it
   * must not be mistaken for the session's own id.
   */
  it("does not take a stray UUID from codex's output for its session id", () => {
    expect(
      scan("codex", 'const requestId = "123e4567-e89b-12d3-a456-426614174000" // from the fixture\r\n'),
    ).toBeUndefined()
  })

  /** OpenCode's id carries its own prefix, so the token alone is unambiguous. */
  it("reads opencode's continue banner", () => {
    expect(scan("opencode", "  Continue  opencode -s ses_ff4aa6205ffehzvZgEfg3vHXmc\r\n")).toBe(
      "ses_ff4aa6205ffehzvZgEfg3vHXmc",
    )
  })

  /**
   * Crush prints a short hash rather than the session's UUID, and that hash is
   * what its `-s` accepts — so the hash is the right thing to store, however
   * unlike a primary key it looks.
   */
  it("reads crush's resume hash", () => {
    expect(scan("crush", "Session  Fix the auth test\r\nContinue crush -s a1b2c3d\r\n")).toBe("a1b2c3d")
  })

  /** Every agent that assigns its own id has nothing to scan for, and says so. */
  it("leaves the assigning agents with no pattern at all", () => {
    for (const agentKey of ["claude", "gemini", "copilot", "qwen"]) {
      expect(findBuiltinAgent(agentKey)?.sessionIdPattern ?? null, agentKey).toBeNull()
    }
  })
})
