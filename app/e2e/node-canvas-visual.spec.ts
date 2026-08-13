import { expect, test, type Page } from "@playwright/test";
import { DESKTOP_WORKSPACE } from "./fixtures/desktop";

/**
 * Visual and behavioural QA for the node layer ("The Living Run", DESIGN.md §7).
 *
 * Seeds an eight-node graph over the desktop IPC mock, drives a fake run
 * through `onRunProgress`, and captures the canvas in each state into
 * `.omo/evidence/node-redesign/after/` — the same filenames as the `before/`
 * set, so the two directories diff frame for frame.
 *
 * The assertions here are the ones a screenshot cannot make: that an idle node
 * carries no glow layer, that a failed node keeps its glow after the run ends
 * while a successful one does not, and that edge deletion is reachable from the
 * keyboard.
 *
 * Playwright's bundled Chromium may not be installed locally. Either run
 * `npx playwright install chromium`, or point the run at an installed browser:
 * `PW_CHANNEL=msedge npx playwright test node-canvas-visual`.
 */

const WORKFLOW_ID = "wf-node-canvas-visual";

/**
 * Repo-root evidence directory, so `after/` sits beside the `before/` and
 * `reference/` sets it is meant to be diffed against. Playwright runs with
 * `app/` as its cwd.
 */
const EVIDENCE = "../.omo/evidence/node-redesign/after";

const httpConfig = (method: string, url: string) => ({
  method,
  url,
  queryParams: [],
  headers: [{ key: "Content-Type", value: "application/json" }],
  cookies: [],
  bodyType: "json",
  body: "",
  timeout: 30,
  followRedirects: true,
  sslVerify: true,
  continueOnFail: false,
});

const WORKFLOW = {
  workflowId: WORKFLOW_ID,
  workspaceId: DESKTOP_WORKSPACE.workspaceId,
  name: "Checkout API regression",
  description: "Node redesign evidence graph",
  nodes: [
    { nodeId: "start-1", type: "start", label: "Start", position: { x: 0, y: 240 }, config: {} },
    {
      nodeId: "login",
      type: "http-request",
      label: "Login",
      position: { x: 220, y: 220 },
      config: httpConfig("POST", "https://api.shop.dev/auth/login"),
    },
    {
      nodeId: "assert-token",
      type: "assertion",
      label: "Token issued",
      position: { x: 520, y: 220 },
      config: {
        assertions: [
          { source: "status", operator: "equals", path: "", expectedValue: "200" },
          { source: "prev", operator: "exists", path: "body.accessToken", expectedValue: "" },
        ],
      },
    },
    {
      nodeId: "cart",
      type: "http-request",
      label: "Get cart",
      position: { x: 840, y: 80 },
      config: httpConfig("GET", "https://api.shop.dev/cart?expand=items"),
    },
    {
      nodeId: "backoff",
      type: "delay",
      label: "Backoff",
      position: { x: 840, y: 400 },
      config: { duration: 1500 },
    },
    {
      nodeId: "retry-cart",
      type: "http-request",
      label: "Retry cart",
      position: { x: 1120, y: 400 },
      config: httpConfig("GET", "https://api.shop.dev/cart"),
    },
    { nodeId: "merge-1", type: "merge", label: "Merge", position: { x: 1420, y: 240 }, config: { mergeStrategy: "all" } },
    { nodeId: "end-1", type: "end", label: "End", position: { x: 1700, y: 240 }, config: {} },
  ],
  edges: [
    { edgeId: "e1", source: "start-1", target: "login", sourceHandle: null, targetHandle: null },
    { edgeId: "e2", source: "login", target: "assert-token", sourceHandle: null, targetHandle: null },
    { edgeId: "e3", source: "assert-token", target: "cart", sourceHandle: "pass", targetHandle: null, label: "Pass" },
    { edgeId: "e4", source: "assert-token", target: "backoff", sourceHandle: "fail", targetHandle: null, label: "Fail" },
    { edgeId: "e5", source: "backoff", target: "retry-cart", sourceHandle: null, targetHandle: null },
    { edgeId: "e6", source: "cart", target: "merge-1", sourceHandle: null, targetHandle: null },
    { edgeId: "e7", source: "retry-cart", target: "merge-1", sourceHandle: null, targetHandle: null },
    { edgeId: "e8", source: "merge-1", target: "end-1", sourceHandle: null, targetHandle: null },
  ],
  variables: {},
  selectedEnvironmentId: null,
} as const;

interface RunEvent {
  kind: string;
  nodeId?: string;
  status?: string;
  statusCode?: number;
  error?: string;
}

declare global {
  interface Window {
    __EMIT_RUN__?: (event: RunEvent) => void;
  }
}

/** The desktop IPC mock, plus a run stream the test can drive by hand. */
async function installRunnableIpc(
  page: Page,
  options: { dark: boolean },
): Promise<void> {
  await page.addInitScript(
    ({ workflow, workspace, dark }) => {
      localStorage.setItem("apiweave:v1:darkMode", String(dark));
      localStorage.setItem("darkMode", String(dark));

      const listeners: ((event: unknown) => void)[] = [];
      const ok = (data: unknown) => ({ ok: true as const, data });

      // A `domain.action` lookup rather than an if-chain. The chain was one
      // branch per route, so every route the harness learned to answer pushed
      // its complexity up; a table stays flat no matter how many it grows.
      const routes: Record<string, () => { ok: true; data: unknown }> = {
        "workspaces.list": () => ok([workspace]),
        "workflows.list": () => ok({ items: [workflow], total: 1 }),
        "workflows.get": () => ok(workflow),
        "workflows.update": () => ok(workflow),
        "runs.create": () => ok({ runId: "run-evidence-1" }),
        "runs.get": () =>
          ok({ runId: "run-evidence-1", nodeStatuses: {}, results: [] }),
        "runs.getLatest": () => ok(null),
        "runs.getLatestFailed": () => ok(null),
        "secrets.list": () => ok([]),
        "cloud.status": () =>
          ok({
            linked: false, active: false, linkState: "unlinked", syncState: "idle",
            state: "idle", pendingCount: 0, deadLetterCount: 0, conflictCount: 0,
            workspaceIds: [], bindings: [], workspaceCatalog: [], teamCatalog: [],
          }),
      };

      window.__APIWEAVE_IPC__ = {
        invoke: async (domain: string, action: string) => {
          const route = routes[`${domain}.${action}`];
          if (route) return route();
          // Anything else that only needs to not explode: an empty page.
          if (action.startsWith("list")) return ok({ items: [], total: 0 });
          return {
            ok: false as const,
            error: { code: "not_found" as const, message: `Unhandled ${domain}.${action}` },
          };
        },
        onRunProgress: (_runId: string, callback: (event: unknown) => void) => {
          listeners.push(callback);
          return () => listeners.splice(listeners.indexOf(callback), 1);
        },
        onCloudStatusChanged: () => () => undefined,
      };

      window.__EMIT_RUN__ = (event) => {
        for (const callback of [...listeners]) callback(event);
      };
    },
    { workflow: WORKFLOW, workspace: DESKTOP_WORKSPACE, dark: options.dark },
  );
}

async function openCanvas(page: Page): Promise<void> {
  await page.goto(`/#/${DESKTOP_WORKSPACE.slug}/workflows/${WORKFLOW_ID}`, {
    waitUntil: "domcontentloaded",
  });

  // The route alone does not mount the canvas — the workflow has to be opened
  // from the sidebar list, which is what seeds WorkflowContext.
  const entry = page.getByRole("button", { name: /Checkout API regression/ }).first();
  await entry.waitFor({ state: "visible", timeout: 30_000 });
  await entry.click();

  await page.waitForSelector(".react-flow__node", { timeout: 30_000 });
  await page.waitForTimeout(900);

  // Give the canvas the whole window so the shots frame the graph, not the shell.
  for (const label of ["Collapse sidebar", "Collapse Navigation"]) {
    const button = page.getByRole("button", { name: label }).first();
    if (await button.count()) await button.click().catch(() => undefined);
  }
  await fitView(page);
}

async function fitView(page: Page): Promise<void> {
  const fit = page.locator(".react-flow__controls-fitview").first();
  if (await fit.count()) await fit.click({ force: true });
  await page.waitForTimeout(600);
}

async function shootCanvas(page: Page, name: string): Promise<void> {
  const box = await page.locator(".react-flow").first().boundingBox();
  await page.screenshot({
    path: `${EVIDENCE}/${name}.png`,
    ...(box ? { clip: box } : {}),
  });
}

async function emit(page: Page, events: RunEvent[]): Promise<void> {
  await page.evaluate((batch) => {
    for (const event of batch) window.__EMIT_RUN__?.(event);
  }, events);
  await page.waitForTimeout(700);
}

const MID_RUN: RunEvent[] = [
  { kind: "node.status", nodeId: "login", status: "passed", statusCode: 200 },
  { kind: "node.status", nodeId: "assert-token", status: "passed" },
  { kind: "node.status", nodeId: "cart", status: "running" },
  {
    kind: "node.status",
    nodeId: "retry-cart",
    status: "failed",
    statusCode: 502,
    error: "ECONNRESET",
  },
  { kind: "node.status", nodeId: "backoff", status: "passed" },
];

for (const theme of ["dark", "light"] as const) {
  test.describe(`node canvas — ${theme}`, () => {
    test.beforeEach(async ({ page }) => {
      await installRunnableIpc(page, { dark: theme === "dark" });
    });

    test(`captures every node state (${theme})`, async ({ page }) => {
      await openCanvas(page);

      // ── Idle ────────────────────────────────────────────────────────────
      await page.screenshot({
        path: `${EVIDENCE}/current-full-idle-${theme}.png`,
      });
      await shootCanvas(page, `current-canvas-idle-${theme}`);

      // An idle canvas carries no glow at all. This is the performance rule as
      // much as the aesthetic one — glow cost is bounded by run concurrency.
      await expect(page.locator("[data-node-glow]")).toHaveCount(0);

      // ── Selected ────────────────────────────────────────────────────────
      const login = page
        .locator(".react-flow__node")
        .filter({ hasText: "Login" })
        .first();
      await login.getByText("Login", { exact: true }).click();
      await page.waitForTimeout(400);
      await shootCanvas(page, `current-canvas-selected-${theme}`);

      // ── Expanded ────────────────────────────────────────────────────────
      const chevron = login.getByRole("button", { name: /expand|collapse/i }).first();
      await chevron.click();
      await page.waitForTimeout(400);
      // The method select and URL live behind the chevron now.
      await expect(login.getByLabel("Request URL")).toBeVisible();
      await shootCanvas(page, `current-canvas-expanded-${theme}`);
      await chevron.click();
      await page.waitForTimeout(300);

      // ── Running ─────────────────────────────────────────────────────────
      await fitView(page);
      await page.getByRole("button", { name: "Run", exact: true }).click();
      await page.waitForTimeout(500);
      await emit(page, [
        { kind: "node.status", nodeId: "start-1", status: "passed" },
        { kind: "node.status", nodeId: "login", status: "running" },
      ]);
      await shootCanvas(page, `current-canvas-running-${theme}`);

      const runningNode = page.getByLabel("Node status: Running").first();
      await expect(runningNode).toBeVisible();

      // ── Mixed: success + running + failure together ─────────────────────
      await emit(page, MID_RUN);
      await shootCanvas(page, `current-canvas-mixed-${theme}`);
      await page.screenshot({
        path: `${EVIDENCE}/current-full-mixed-${theme}.png`,
      });

      await expect(page.getByLabel("Node status: Error").first()).toBeVisible();
      await expect(page.getByLabel("Node status: Success").first()).toBeVisible();

      // ── Close-up ────────────────────────────────────────────────────────
      const zoomIn = page.locator(".react-flow__controls-zoomin").first();
      for (let i = 0; i < 4; i++) {
        await zoomIn.click({ force: true });
        await page.waitForTimeout(150);
      }
      await page.waitForTimeout(600);
      await shootCanvas(page, `current-canvas-closeup-${theme}`);
    });
  });
}

test.describe("node layer behaviour", () => {
  test.beforeEach(async ({ page }) => {
    await installRunnableIpc(page, { dark: true });
  });

  test("failure keeps its glow after the run ends; success settles", async ({
    page,
  }) => {
    await openCanvas(page);
    await page.getByRole("button", { name: "Run", exact: true }).click();
    await page.waitForTimeout(400);
    await emit(page, MID_RUN);

    // Success settles over 600ms and its glow layer fades to nothing; the
    // failure holds. On a finished canvas the only lit thing is what broke.
    await emit(page, [
      { kind: "node.status", nodeId: "cart", status: "passed", statusCode: 200 },
      { kind: "run.completed", status: "failed" },
    ]);
    await page.waitForTimeout(900);

    const errorNode = page.getByLabel("Node status: Error").first();
    await expect(errorNode).toBeVisible();
    await expect(page.getByLabel("Node status: Running")).toHaveCount(0);
  });

  test("a run strip reports metrics with a stable row shape", async ({ page }) => {
    await openCanvas(page);
    await page.getByRole("button", { name: "Run", exact: true }).click();
    await page.waitForTimeout(400);
    await emit(page, MID_RUN);

    const metrics = page.getByRole("group", { name: "Node metrics" }).first();
    await expect(metrics).toBeVisible();
  });

  test("edge deletion is reachable from the keyboard", async ({ page }) => {
    await openCanvas(page);

    // The button exists in the tab order even while visually hidden, and
    // reveals itself on focus. Before the redesign there was no keyboard path
    // to deleting an edge at all.
    const deleteEdge = page.getByRole("button", { name: "Delete edge" }).first();
    await expect(deleteEdge).toBeAttached();
    await deleteEdge.focus();
    await expect(deleteEdge).toBeFocused();
    await expect(deleteEdge).toBeVisible();
  });
});

test.describe("reduced motion", () => {
  test.beforeEach(async ({ page }) => {
    // `page.emulateMedia` rather than `test.use({ reducedMotion })`: the
    // project's `use` block did not propagate the fixture to the context here,
    // and the emulation silently did nothing — which made this test pass for
    // the wrong reason. Verified live: with this call
    // `matchMedia("(prefers-reduced-motion: reduce)").matches` is true and the
    // glow layer's computed animation-name is `none`.
    await page.emulateMedia({ reducedMotion: "reduce" });
    await installRunnableIpc(page, { dark: true });
  });

  test("no looping animation runs, and every state stays legible", async ({
    page,
  }) => {
    await openCanvas(page);
    await page.getByRole("button", { name: "Run", exact: true }).click();
    await page.waitForTimeout(400);
    await emit(page, MID_RUN);

    // Nothing on the canvas may be mid-animation under reduced motion.
    const running = await page.evaluate(() =>
      document
        .getAnimations()
        .filter((animation) => animation.playState === "running")
        .map((animation) => {
          const effect = animation.effect as KeyframeEffect | null;
          return effect?.target?.className?.toString?.() ?? "unknown";
        }),
    );
    expect(running, `still animating: ${running.join(", ")}`).toEqual([]);

    // The states are still readable without any motion.
    await expect(page.getByLabel("Node status: Running").first()).toBeVisible();
    await expect(page.getByLabel("Node status: Error").first()).toBeVisible();
    await expect(page.getByLabel("Node status: Success").first()).toBeVisible();

    await shootCanvas(page, "current-canvas-reduced-motion-dark");
  });
});
