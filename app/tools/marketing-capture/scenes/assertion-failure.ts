/**
 * S02 `assertion-failure` — a broken response is localised to the exact
 * assertion rule and failure branch rather than buried in a log.
 *
 * One honest limitation shapes every frame here. The product records the rule
 * that failed (`RunResult.assertions`) and the response that failed it, but the
 * canvas node renders neither: `AssertionNode` reads `data.assertionStats`, and
 * nothing in the renderer ever writes that field. So "expected 4200, actual
 * 3900" cannot come from one node. It is proved across two frames instead —
 * the rule, from the assertion editor, and the actual value, from `Get cart`'s
 * recorded response — which is what the product can truthfully show today.
 */

import {
  MODAL_PANEL,
  collapseChrome,
  fitCanvas,
  openNodeModal,
  openRunTimeline,
  openWorkflow,
  playRun,
  waitForVisibleText,
} from "../harness";
import {
  CAPTURE_ENVIRONMENT,
  CAPTURE_SECRETS,
  CHECKOUT_WORKFLOW,
  FAILING_RUN,
} from "../fixtures";
import { node, type Scene } from "../scene";

const BRIDGE = {
  workflow: CHECKOUT_WORKFLOW,
  run: FAILING_RUN,
  failedRun: FAILING_RUN,
  environments: [CAPTURE_ENVIRONMENT],
  secrets: CAPTURE_SECRETS,
} as const;

export const FAILING_BEATS = [
  { nodeId: "login", workingMs: 620, statusCode: 201 },
  { nodeId: "token-issued", workingMs: 300 },
  { nodeId: "get-cart", workingMs: 480, statusCode: 200 },
  {
    nodeId: "cart-total",
    workingMs: 420,
    status: "failed" as const,
    message: "Assertion failed: 1/1 rules failed",
  },
  { nodeId: "alert", workingMs: 420, statusCode: 202 },
  { nodeId: "end", workingMs: 200 },
] as const;

async function runToFailure(page: import("@playwright/test").Page) {
  await openWorkflow(page, CHECKOUT_WORKFLOW.name);
  await collapseChrome(page);
  await fitCanvas(page);
  await playRun(page, {
    runId: FAILING_RUN.runId,
    finishedRun: FAILING_RUN,
    beats: FAILING_BEATS,
    status: "failed",
  });
  await fitCanvas(page);
}

export const assertionFailure: Scene = {
  id: "assertion-failure",
  bridge: BRIDGE,
  viewport: { width: 1600, height: 1000 },
  prepare: runToFailure,
  requiredStrings: [
    "Get cart",
    "200 OK",
    "Cart total matches",
    "Post regression alert",
    "202 Accepted",
  ],
  stills: [
    {
      id: "feature-failure",
      placement: "feature",
      width: 960,
      height: 720,
      claim: "A failure names the check that broke and lights the branch it took.",
      alt: "An APIWeave run where Get cart returned 200 OK but the Cart total matches check failed, sending the run down its failure branch to a regression alert.",
      caption: "The request succeeded. The check did not.",
      subjects: [node("get-cart"), node("cart-total"), node("alert")],
      camera: { fit: true },
      byteBudget: 120_000,
    },
    {
      id: "feature-failure-mobile",
      placement: "mobile",
      width: 750,
      height: 1000,
      claim: "The same failure, framed for a narrow card.",
      alt: "A failed APIWeave cart-total check above the regression alert its failure branch triggered.",
      caption: "The request succeeded. The check did not.",
      subjects: [node("cart-total"), node("alert")],
      camera: { fit: true },
      byteBudget: 110_000,
    },
  ],
};

/** The rule itself, in the editor that owns it. */
export const assertionRule: Scene = {
  id: "assertion-rule",
  bridge: BRIDGE,
  viewport: { width: 1600, height: 1000 },
  prepare: async (page) => {
    await runToFailure(page);
    await openNodeModal(page, "cart-total", "Rules");
    await waitForVisibleText(page, "response.body.total");
  },
  requiredStrings: ["Cart total matches", "response.body.total", "4200"],
  stills: [
    {
      id: "atlas-assertion-failure",
      placement: "gallery",
      width: 1440,
      height: 900,
      claim: "The exact rule: source, path, operator and expected value.",
      alt: "The APIWeave assertion editor showing one rule: the previous response's body.total must equal 4200.",
      caption: "Assertions — one rule, named and checked.",
      subjects: [MODAL_PANEL],
      pad: 8,
      byteBudget: 160_000,
    },
  ],
};

/** The response that failed the rule — where `3900` actually lives. */
export const failingResponse: Scene = {
  id: "failing-response",
  bridge: BRIDGE,
  // Taller than the other scenes: the node editor fills the window, and a 4:3
  // crop of a 1584-wide panel needs 1188 rows to hold it without cutting it.
  viewport: { width: 1600, height: 1260 },
  prepare: async (page) => {
    await runToFailure(page);
    await openNodeModal(page, "get-cart");
    await waitForVisibleText(page, "3900");
  },
  requiredStrings: ["Get cart", "3900"],
  stills: [
    {
      id: "step-inspect",
      placement: "step",
      width: 960,
      height: 720,
      claim: "The recorded response is what makes the failure inspectable.",
      alt: "An APIWeave response viewer showing the cart body whose total is 3900, the value that failed the 4200 check.",
      caption: "Inspect — the response the check rejected.",
      subjects: [MODAL_PANEL],
      pad: 8,
      byteBudget: 120_000,
    },
  ],
};

/** Parallel timing, one clock, with the failed node on it. */
export const runTimeline: Scene = {
  id: "run-timeline",
  bridge: BRIDGE,
  viewport: { width: 1600, height: 1000 },
  prepare: async (page) => {
    await runToFailure(page);
    await openRunTimeline(page, FAILING_RUN.runId);
    await waitForVisibleText(page, "Run timeline");
  },
  requiredStrings: ["Run timeline", "Resolved secrets (values masked)"],
  stills: [
    {
      id: "atlas-run-timeline",
      placement: "gallery",
      width: 1440,
      height: 900,
      claim: "Parallel branches and the failed step share one clock, and secrets stay masked.",
      alt: "The APIWeave run timeline: per-node bars on one clock, the failed cart-total step, and a masked resolved-secret list.",
      caption: "Run timeline — parallel timing, one clock.",
      subjects: [MODAL_PANEL],
      pad: 8,
      byteBudget: 160_000,
    },
  ],
};
