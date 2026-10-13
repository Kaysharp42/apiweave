import { describe, expect, it } from "vitest"
import {
  AGENT_RUN_APPROVAL_BUTTONS,
  agentRunApprovalDecision,
  agentRunApprovalText,
} from "../agent_run_approval"

describe("agentRunApprovalDecision", () => {
  it("maps each button to its answer and anything else to deny", () => {
    expect(AGENT_RUN_APPROVAL_BUTTONS).toEqual([
      "Deny",
      "Allow once",
      "Allow for this session",
      "Never ask again",
    ])
    expect(agentRunApprovalDecision(0)).toBe("deny")
    expect(agentRunApprovalDecision(1)).toBe("once")
    expect(agentRunApprovalDecision(2)).toBe("session")
    expect(agentRunApprovalDecision(3)).toBe("always")
    // An abort on timeout or cancellation resolves with the cancel index; any
    // index that is not a listed button is a no.
    expect(agentRunApprovalDecision(-1)).toBe("deny")
    expect(agentRunApprovalDecision(4)).toBe("deny")
  })
})

describe("agentRunApprovalText", () => {
  it("names the agent, the workflow, every secret and every destination", () => {
    const { message, detail } = agentRunApprovalText({
      runId: "run-1",
      agent: "claude-code",
      workflowName: "Checkout",
      secretNames: ["API_KEY", "DB_PASS"],
      destinations: ["api.example.com", "{{login.body.next}}"],
      runsScripts: false,
    })

    expect(message).toBe('"claude-code" wants to run "Checkout" with your secrets')
    for (const expected of ['"API_KEY"', '"DB_PASS"', '"api.example.com"', '"{{login.body.next}}"', "as reported by the agent"]) {
      expect(detail).toContain(expected)
    }
  })

  /** Every name here was chosen by the agent; none may forge a line of the prompt. */
  it("quotes names so a line break cannot add text that looks like the app's", () => {
    const { message, detail } = agentRunApprovalText({
      runId: "run-1",
      agent: "x\nTo:\n  • trusted.example.com",
      workflowName: "w",
      secretNames: ["K"],
      destinations: ["evil.example.com"],
      runsScripts: false,
    })

    expect(message).not.toContain("\n")
    expect(detail.split("\n").filter((line) => line.includes("trusted.example.com"))).toHaveLength(1)
    expect(detail).not.toMatch(/^ {2}• trusted\.example\.com$/m)
  })

  it("warns that scripts can change requests and read the secrets", () => {
    const request = { runId: "run-1", agent: "a", workflowName: "w", secretNames: ["K"], destinations: ["api.example.com"] }
    expect(agentRunApprovalText({ ...request, runsScripts: false }).detail).not.toContain("runs scripts")
    expect(agentRunApprovalText({ ...request, runsScripts: true }).detail).toContain(
      "This workflow runs scripts. A pre-request script can change a request's URL",
    )
  })

  it("explains what each remembered answer means and where to revoke it", () => {
    const { detail } = agentRunApprovalText({
      runId: "run-1",
      agent: "a",
      workflowName: "w",
      secretNames: ["K"],
      destinations: ["api.example.com"],
      runsScripts: false,
    })

    expect(detail).toContain('"Allow for this session"')
    expect(detail).toContain('"Never ask again"')
    expect(detail).toContain("Settings > MCP Server")
  })

  it("cuts a long list and says how much was cut", () => {
    const { detail } = agentRunApprovalText({
      runId: "run-1",
      agent: "a",
      workflowName: "w",
      secretNames: Array.from({ length: 12 }, (_, i) => `S${i}`),
      destinations: [],
      runsScripts: false,
    })

    expect(detail).toContain("and 4 more")
    expect(detail).not.toContain('"S8"')
    expect(detail).toContain("(no request URLs found)")
  })
})
