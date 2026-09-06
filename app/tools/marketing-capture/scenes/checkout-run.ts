/**
 * S01 `checkout-run` — a visual API workflow visibly changes as requests,
 * assertions, branches and a merge execute locally.
 *
 * Two states are captured from the same graph: the idle authored graph
 * (Assemble step and the request-editor atlas still) and the finished passing
 * run (hero, Run step, workflow feature, canvas atlas, OG).
 *
 * Feature and step frames expand their subject node rather than showing more
 * collapsed nodes. A collapsed graph is wide and short, so a 4:3 crop of it is
 * mostly empty canvas — the defect this phase exists to remove.
 */

import {
  MODAL_PANEL,
  collapseChrome,
  fitCanvas,
  openNodeModal,
  openWorkflow,
  playRun,
  waitForVisibleText,
} from "../harness";
import {
  CAPTURE_ENVIRONMENT,
  CAPTURE_SECRETS,
  CHECKOUT_WORKFLOW,
  PASSING_RUN,
} from "../fixtures";
import { node, type Scene } from "../scene";

const BRIDGE = {
  workflow: CHECKOUT_WORKFLOW,
  environments: [CAPTURE_ENVIRONMENT],
  secrets: CAPTURE_SECRETS,
} as const;

/** The five nodes the hero frames: one branch, one merge, no clipped node. */
const CORE = [
  node("login"),
  node("token-issued"),
  node("get-cart"),
  node("cart-total"),
  node("merge"),
];

/** Every node, listed so the crop guard fails loudly if one is off-camera. */
const ALL_NODES = [
  node("start"),
  node("login"),
  node("token-issued"),
  node("get-cart"),
  node("cart-total"),
  node("alert"),
  node("merge"),
  node("end"),
];

export const PASSING_BEATS = [
  { nodeId: "login", workingMs: 620, statusCode: 201 },
  { nodeId: "token-issued", workingMs: 300 },
  { nodeId: "get-cart", workingMs: 480, statusCode: 200 },
  { nodeId: "cart-total", workingMs: 300 },
  { nodeId: "merge", workingMs: 240 },
  { nodeId: "end", workingMs: 200 },
] as const;

export const checkoutRunIdle: Scene = {
  id: "checkout-run-idle",
  bridge: BRIDGE,
  viewport: { width: 1600, height: 1000 },
  prepare: async (page) => {
    await openWorkflow(page, CHECKOUT_WORKFLOW.name);
    await collapseChrome(page);
    await fitCanvas(page);
  },
  requiredStrings: [
    "Checkout API regression",
    "Staging",
    "Login",
    "POST",
    "Token issued",
    "Get cart",
    "GET",
    "Cart total matches",
    "Merge",
  ],
  stills: [
    {
      id: "step-assemble",
      placement: "step",
      width: 960,
      height: 720,
      claim: "Nodes and their wiring prove assembly, not a wide idle window.",
      alt: "The start of an APIWeave workflow: Start into a POST Login request, branching into a token assertion.",
      caption: "Assemble — chain requests, checks and branches on the canvas.",
      subjects: [node("start"), node("login"), node("token-issued")],
      camera: { fit: true, zoom: -1 },
      byteBudget: 120_000,
    },
  ],
};

/** The request editor is a modal, so it is its own product state. */
export const checkoutRequestEditor: Scene = {
  id: "checkout-request-editor",
  bridge: BRIDGE,
  viewport: { width: 1600, height: 1000 },
  prepare: async (page) => {
    await openWorkflow(page, CHECKOUT_WORKFLOW.name);
    await collapseChrome(page);
    await fitCanvas(page);
    await openNodeModal(page, "login", "Body");
    await waitForVisibleText(page, "{{secrets.QA_PASSWORD}}");
  },
  requiredStrings: ["Login", "POST", "{{secrets.QA_PASSWORD}}"],
  stills: [
    {
      id: "atlas-request-editor",
      placement: "gallery",
      width: 1440,
      height: 900,
      claim: "Real request method, URL template and a body that references a named secret, never a value.",
      alt: "The APIWeave request editor: a POST login body whose password field is the reference {{secrets.QA_PASSWORD}}.",
      caption: "Request editor — the body carries a secret reference, not a secret.",
      subjects: [MODAL_PANEL],
      pad: 8,
      byteBudget: 160_000,
    },
  ],
};

export const checkoutRunPassing: Scene = {
  id: "checkout-run",
  bridge: { ...BRIDGE, run: PASSING_RUN },
  viewport: { width: 1600, height: 1000 },
  prepare: async (page) => {
    await openWorkflow(page, CHECKOUT_WORKFLOW.name);
    await collapseChrome(page);
    await fitCanvas(page);
    await playRun(page, {
      runId: PASSING_RUN.runId,
      finishedRun: PASSING_RUN,
      beats: PASSING_BEATS,
    });
    await fitCanvas(page);
  },
  requiredStrings: [
    "Checkout API regression",
    "Staging",
    "Login",
    "Token issued",
    "Get cart",
    "Cart total matches",
    "Merge",
    "200 OK",
    "201 Created",
  ],
  stills: [
    {
      id: "hero-fallback",
      placement: "hero",
      width: 1600,
      height: 900,
      alsoAt: [960],
      claim: "A complete, readable run state when motion is unavailable.",
      alt: "An APIWeave workflow after a passing run: Login, a token assertion, Get cart, a cart-total check and a merge, all green.",
      caption: "One run, start to green, on the local canvas.",
      subjects: CORE,
      camera: { fit: true, zoom: -1 },
      byteBudget: 150_000,
    },
    {
      id: "feature-workflow",
      placement: "feature",
      width: 960,
      height: 720,
      claim: "Graph state changes are readable at card size.",
      alt: "Three APIWeave nodes after a run: Login at 201 Created feeding a token assertion and a GET Get cart at 200 OK.",
      caption: "Every node carries its own result.",
      subjects: [node("login"), node("token-issued"), node("get-cart")],
      camera: { fit: true, zoom: -1 },
      pad: 8,
      byteBudget: 120_000,
    },
    {
      id: "step-run",
      placement: "step",
      width: 960,
      height: 720,
      claim: "Per-node status, timing and the branch not taken prove local execution.",
      alt: "An APIWeave Get cart node reporting 200 OK in 96 ms, its cart-total check green, and the failure branch left skipped.",
      caption: "Run — every request answers on your machine.",
      subjects: [node("get-cart"), node("cart-total"), node("alert")],
      camera: { fit: true },
      byteBudget: 120_000,
    },
    {
      id: "atlas-canvas",
      placement: "gallery",
      width: 1440,
      height: 900,
      claim: "Canvas graph and branch topology.",
      alt: "The whole Checkout API regression workflow: eight nodes, two parallel branches, a merge and a single end.",
      caption: "Canvas — the whole regression in one view.",
      subjects: ALL_NODES,
      camera: { fit: true, zoom: -1 },
      pad: 8,
      byteBudget: 160_000,
    },
    {
      id: "og-social",
      placement: "og",
      width: 1200,
      height: 630,
      claim: "The same product-valid run state inside the social safe area.",
      alt: "APIWeave: a visual API workflow after a passing run.",
      caption: "APIWeave — visual API workflows that run locally.",
      subjects: CORE,
      camera: { fit: true, zoom: -2 },
      byteBudget: 200_000,
    },
  ],
};

/**
 * The hero's mobile composition.
 *
 * A separate scene, not a second crop of the desktop frame: at 820px the
 * desktop app lays itself out differently, and the brief's rule is that a
 * mobile still is its own composition rather than a squeezed one. Three nodes
 * of the branch, portrait, at the size a phone actually shows them.
 */
export const checkoutRunMobile: Scene = {
  id: "checkout-run-mobile",
  bridge: { ...BRIDGE, run: PASSING_RUN },
  viewport: { width: 820, height: 1000 },
  prepare: async (page) => {
    await openWorkflow(page, CHECKOUT_WORKFLOW.name);
    await collapseChrome(page);
    await fitCanvas(page);
    await playRun(page, {
      runId: PASSING_RUN.runId,
      finishedRun: PASSING_RUN,
      beats: PASSING_BEATS,
    });
    await fitCanvas(page);
  },
  requiredStrings: ["Login", "Get cart", "200 OK", "201 Created"],
  stills: [
    {
      id: "hero-fallback-mobile",
      placement: "mobile",
      width: 750,
      height: 900,
      claim: "The same complete run state, composed for a phone.",
          alt: "An APIWeave workflow on a narrow screen after a passing run: a green token assertion above a Get cart request at 200 OK.",
      caption: "One run, start to green, on the local canvas.",
      subjects: [node("token-issued"), node("get-cart")],
      camera: { fit: true, zoom: 3 },
      pad: 24,
      byteBudget: 130_000,
    },
  ],
};
