import { describe, expect, it } from "vitest"
import { agentRunApprovalText } from "../agent_run_approval"

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
