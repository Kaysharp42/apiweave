/**
 * S04 `agent-repair` — a local coding agent can diagnose a failed run over MCP,
 * patch the graph under a revision guard, and make the change appear live.
 *
 * Deliberately re-scoped from the Phase 0 brief, and this is the reason.
 *
 * The brief asked for a terminal beside the canvas, with `workflow_diagnose`
 * and `workflows_patch` output in it. That output does not belong to APIWeave:
 * what a viewer would see in a terminal is a *third-party agent CLI's*
 * interface rendering those tool calls. Producing it deterministically would
 * mean authoring an agent's transcript — inventing another vendor's UI — and
 * producing it truthfully would mean hand-recording a real agent session, which
 * no clean checkout could regenerate. Both fail a rule this programme set for
 * itself.
 *
 * So the claim is proved with the surfaces APIWeave owns: the failed pre-repair
 * graph, and the repaired graph arriving over the workflow-changed channel —
 * the real path an MCP write takes to an open canvas
 * (`useWorkflowLiveUpdates`), rev-guarded, 7 → 8. The tool surface the agent
 * used is proved separately by `mcp-bridge`.
 *
 * The product's "An agent is running …" notice is fired here too, but it is
 * deliberately not in frame: `useAgentRunNotice` suppresses it for the workflow
 * the canvas already has open, because that run is being narrated on the canvas
 * itself. Attribution is therefore the caption's job, not a chrome element's.
 */

import {
  applyAgentWrite,
  collapseChrome,
  fitCanvas,
  openWorkflow,
  playRun,
} from "../harness";
import {
  CAPTURE_ENVIRONMENT,
  CAPTURE_IDS,
  CAPTURE_SECRETS,
  CHECKOUT_WORKFLOW,
  CHECKOUT_WORKFLOW_UNWIRED,
  FAILING_RUN_UNWIRED,
} from "../fixtures";
import { node, type Scene } from "../scene";

const UNWIRED_BEATS = [
  { nodeId: "login", workingMs: 520, statusCode: 201 },
  { nodeId: "token-issued", workingMs: 280 },
  { nodeId: "get-cart", workingMs: 440, statusCode: 200 },
  {
    nodeId: "cart-total",
    workingMs: 400,
    status: "failed" as const,
    message: "Assertion failed: 1/1 rules failed",
  },
] as const;

export const agentRepair: Scene = {
  id: "agent-repair",
  bridge: {
    workflow: CHECKOUT_WORKFLOW_UNWIRED,
    run: FAILING_RUN_UNWIRED,
    failedRun: FAILING_RUN_UNWIRED,
    environments: [CAPTURE_ENVIRONMENT],
    secrets: CAPTURE_SECRETS,
  },
  viewport: { width: 1600, height: 1000 },
  prepare: async (page) => {
    await openWorkflow(page, CHECKOUT_WORKFLOW_UNWIRED.name);
    await collapseChrome(page);
    await fitCanvas(page);
    await playRun(page, {
      runId: FAILING_RUN_UNWIRED.runId,
      finishedRun: FAILING_RUN_UNWIRED,
      beats: UNWIRED_BEATS,
      status: "failed",
    });
    await fitCanvas(page);

    // The repair itself: revision 8 arrives on the channel an MCP write really
    // uses, and the canvas grows the fail-branch edge.
    await applyAgentWrite(page, {
      workflow: CHECKOUT_WORKFLOW,
      runStartedBy: {
        runId: FAILING_RUN_UNWIRED.runId,
        workflowId: CAPTURE_IDS.workflowId,
        workspaceId: CAPTURE_IDS.workspaceId,
      },
    });
    // The repair either landed or it did not: the fail-branch edge is the
    // whole subject, so its absence must fail the capture rather than ship a
    // frame of the unrepaired graph.
    await page.waitForSelector('.react-flow__edge[data-id="e-total-fail-alert"]');
    await fitCanvas(page);
  },
  requiredStrings: [
    "Checkout API regression",
    "Cart total matches",
    "Post regression alert",
  ],
  stills: [
    {
      id: "feature-agent-repair",
      placement: "feature",
      width: 960,
      height: 720,
      claim: "An agent's MCP write lands on the open canvas as a visible graph repair.",
      alt: "An APIWeave canvas after an agent patched it: the failed cart-total check now has a failure branch reaching the regression alert.",
      caption: "An agent found the missing failure branch and wired it.",
      subjects: [node("cart-total"), node("alert")],
      camera: { fit: true },
      byteBudget: 120_000,
    },
    {
      id: "atlas-agent-repair",
      placement: "gallery",
      width: 1440,
      height: 900,
      claim: "The whole graph after an agent's revision-guarded repair.",
      alt: "The Checkout API regression workflow after an agent's patch: the failure branch now reaches the regression alert, and both outcomes reach the single end node.",
      caption: "Agents — diagnose, patch, and watch it land.",
      subjects: [
        node("login"),
        node("get-cart"),
        node("cart-total"),
        node("alert"),
        node("merge"),
      ],
      camera: { fit: true, zoom: -1 },
      pad: 8,
      byteBudget: 160_000,
    },
  ],
};
