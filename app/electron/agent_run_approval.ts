import type { AgentRunApprovalRequest } from "../core/runner/scheduler"

/** How long the question stays open. Unanswered is a no. */
export const AGENT_RUN_APPROVAL_TIMEOUT_MS = 2 * 60 * 1000

/** Long lists are cut so the buttons stay on screen; the count says what was cut. */
const MAX_LISTED = 8

/**
 * The approval question for an agent-started run that would send secrets.
 * Electron-free so it can be tested; main.ts shows it as a native dialog —
 * main-process UI no MCP client can reach or answer, and which no page script
 * can draw over or click.
 *
 * Every name in it — the agent's, the workflow's, the secrets', the hosts' —
 * was chosen by someone else, so each is quoted as data.
 */
export function agentRunApprovalText(request: AgentRunApprovalRequest): { message: string; detail: string } {
  return {
    message: `${JSON.stringify(request.agent)} wants to run ${JSON.stringify(request.workflowName)} with your secrets`,
    detail: [
      "The agent says it is:",
      `  ${JSON.stringify(request.agent)} (as reported by the agent)`,
      "",
      "Secrets this run would send:",
      ...listed(request.secretNames),
      "",
      "To:",
      ...listed(request.destinations.length > 0 ? request.destinations : ["(no request URLs found)"]),
      "",
      ...(request.runsScripts
        ? [
            "This workflow runs scripts. A pre-request script can change a request's URL, headers and body, and can read the secrets above.",
            "",
          ]
        : []),
      "Allow only if you trust the agent and these destinations. Once allowed, a request to any host not listed here fails — including one whose URL is shown as written, or is changed while the run executes.",
      `If you do not answer within ${AGENT_RUN_APPROVAL_TIMEOUT_MS / 60000} minutes, the run is refused.`,
    ].join("\n"),
  }
}

function listed(items: readonly string[]): string[] {
  const shown = items.slice(0, MAX_LISTED).map((item) => `  • ${JSON.stringify(item)}`)
  return items.length > MAX_LISTED ? [...shown, `  … and ${items.length - MAX_LISTED} more`] : shown
}
