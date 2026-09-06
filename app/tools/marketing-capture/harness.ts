/**
 * The capture harness: the real desktop renderer, driven by a scripted IPC
 * bridge.
 *
 * This is the same technique as `app/e2e/fixtures/desktop.ts` — the Vite
 * renderer with `window.__APIWEAVE_IPC__` installed before navigation — widened
 * to the domains the marketing scenes need (environments, runs, secrets, MCP,
 * agents, cloud conflicts) and given a control channel, `window.__CAPTURE__`,
 * so a scene can release run-progress events on its own clock.
 *
 * Nothing here composites text into the product. Every string a capture shows
 * is rendered by the shipping renderer from the fixtures in `fixtures.ts`.
 */

import type { Page } from "@playwright/test";
import { CAPTURE_WORKSPACE } from "./fixtures";

export type CaptureBridgeOptions = {
  /** The single workflow the mock serves. */
  readonly workflow: unknown;
  /** Returned by `runs.getLatest`, and by `runs.get` once a scripted run ends. */
  readonly run?: unknown;
  /** Returned by `runs.getLatestFailed` — drives the "resume failed" affordance. */
  readonly failedRun?: unknown;
  readonly environments?: readonly unknown[];
  readonly secrets?: readonly unknown[];
  readonly mcp?: {
    readonly running: boolean;
    readonly config: unknown;
    readonly tools: readonly { name: string; description: string }[];
    readonly prompts: readonly unknown[];
    readonly resources: readonly unknown[];
    readonly test: { ok: boolean; status: number | null };
  };
  readonly cloud?: unknown;
  readonly conflict?: unknown;
  readonly conflicts?: readonly unknown[];
  /** Extra `localStorage` seeds, merged over the capture defaults. */
  readonly storage?: Readonly<Record<string, string>>;
};

/**
 * Seeded before the bundle runs.
 *
 * `darkMode` — the media set is dark-theme; `App.tsx` reads it on first render.
 * `canvasPrefs` — zustand-persist envelope, only to turn contextual tips off so
 * a first-run hint cannot land in the middle of a frame.
 * `autoSaveEnabled` — no debounce churn while a scene is being staged.
 */
const CAPTURE_STORAGE: Readonly<Record<string, string>> = {
  "apiweave:v1:darkMode": "true",
  "apiweave:v1:autoSaveEnabled": "false",
  "apiweave:v1:canvasPrefs": JSON.stringify({
    state: {
      dragMode: "pan",
      locked: false,
      snapToGrid: false,
      gridSize: 24,
      wheelZoom: true,
      tipsEnabled: false,
    },
    version: 0,
  }),
};

/** Kills the caret, hover transitions that would smear a frame, and scrollbars. */
const CAPTURE_CSS = `
  *, *::before, *::after { caret-color: transparent !important; }
  ::-webkit-scrollbar { width: 0 !important; height: 0 !important; }
`;

declare global {
  interface Window {
    __APIWEAVE_IPC__?: unknown;
    __APIWEAVE_MCP__?: unknown;
    __CAPTURE__?: {
      hasListener: (runId: string) => boolean;
      emitRunProgress: (event: unknown) => void;
      emitRunStarted: (event: unknown) => void;
      emitWorkflowChanged: (event: unknown) => void;
      setRun: (run: unknown) => void;
      setWorkflow: (workflow: unknown) => void;
    };
  }
}

export async function installCaptureBridge(
  page: Page,
  options: CaptureBridgeOptions,
): Promise<void> {
  await page.addInitScript((raw) => {
    const opts = raw as CaptureBridgeOptions;
    for (const [key, value] of Object.entries({
      ...(raw as { storageDefaults: Record<string, string> }).storageDefaults,
      ...(opts.storage ?? {}),
    })) {
      localStorage.setItem(key, value);
      localStorage.setItem(key.replace(/^apiweave:v1:/, ""), value);
    }

    let workflow: unknown = opts.workflow;
    let run: unknown = opts.run ?? null;
    const listeners = new Map<string, (event: unknown) => void>();
    const runStartedListeners = new Set<(event: unknown) => void>();
    const workflowListeners = new Set<(event: unknown) => void>();

    window.__CAPTURE__ = {
      hasListener: (runId: string) => listeners.has(runId),
      emitRunProgress: (event) => {
        const runId = (event as { runId?: string }).runId ?? "";
        const stamped = {
          seq: Date.now(),
          ts: new Date().toISOString(),
          ...(event as Record<string, unknown>),
        };
        listeners.get(runId)?.(stamped);
      },
      emitRunStarted: (event) => {
        for (const listener of runStartedListeners) listener(event);
      },
      emitWorkflowChanged: (event) => {
        for (const listener of workflowListeners) listener(event);
      },
      setRun: (next) => {
        run = next;
      },
      setWorkflow: (next) => {
        workflow = next;
      },
    };

    const list = (items: readonly unknown[]) => ({ items, total: items.length });

    // One table, so an unhandled call is a loud `not_found` rather than a
    // silently empty panel — the same posture as the e2e fixture.
    const handlers: Record<string, () => unknown> = {
      "workspaces.list": () => [
        (raw as { workspace: unknown }).workspace,
      ],
      "workspaces.get": () => (raw as { workspace: unknown }).workspace,
      "workflows.list": () => list([workflow]),
      "workflows.get": () => workflow,
      "workflows.update": () => workflow,
      "environments.list": () => list(opts.environments ?? []),
      "environments.listForScope": () => list(opts.environments ?? []),
      "projects.list": () => list([]),
      "collections.list": () => list([]),
      "nodePresets.list": () => list([]),
      "secrets.list": () => opts.secrets ?? [],
      "settings.get": () => ({ allowPrivateNetworks: false }),
      "runs.list": () => list(run ? [run] : []),
      "runs.listByWorkflow": () => list(run ? [run] : []),
      "runs.listByWorkspace": () => list(run ? [run] : []),
      "runs.get": () => run,
      "runs.getLatest": () => run,
      "runs.getLatestFailed": () => opts.failedRun ?? null,
      // A freshly enqueued run: same identity, no evidence yet. The scene
      // releases the transitions and swaps in the finished run before
      // `run.finished`, which is when the renderer re-reads it.
      "runs.create": () => ({
        ...(run as Record<string, unknown>),
        status: "running",
        results: [],
        nodeStatuses: {},
        completedAt: null,
        duration: null,
      }),
      "runs.cancel": () => run,
      "cloud.status": () =>
        opts.cloud ?? {
          linked: false,
          active: false,
          linkState: "unlinked",
          syncState: "idle",
          state: "idle",
          pendingCount: 0,
          deadLetterCount: 0,
          conflictCount: 0,
          workspaceIds: [],
          bindings: [],
          workspaceCatalog: [],
          teamCatalog: [],
        },
      // The cloud pages call these actions by their wire names.
      "cloud.conflict-list": () => list(opts.conflicts ?? []),
      "cloud.conflict-get": () => opts.conflict ?? null,
      "cloud.devices": () => list([]),
    };

    window.__APIWEAVE_IPC__ = {
      invoke: async (domain: string, action: string) => {
        const handler =
          handlers[`${domain}.${action}`] ??
          (action.startsWith("list")
            ? () => list([])
            : undefined);
        if (handler === undefined) {
          return {
            ok: false as const,
            error: {
              code: "not_found" as const,
              message: `Unhandled capture IPC call: ${domain}.${action}`,
            },
          };
        }
        return { ok: true as const, data: handler() };
      },
      onRunProgress: (runId: string, callback: (event: unknown) => void) => {
        listeners.set(runId, callback);
        return () => listeners.delete(runId);
      },
      onRunStarted: (callback: (event: unknown) => void) => {
        runStartedListeners.add(callback);
        return () => runStartedListeners.delete(callback);
      },
      onAgentWrite: () => () => undefined,
      onCloudStatusChanged: () => () => undefined,
      onWorkflowChanged: (callback: (event: unknown) => void) => {
        workflowListeners.add(callback);
        return () => workflowListeners.delete(callback);
      },
    };

    if (opts.mcp) {
      const mcp = opts.mcp;
      let running = mcp.running;
      window.__APIWEAVE_MCP__ = {
        getStatus: async () => ({ running, config: running ? mcp.config : null }),
        enable: async () => {
          running = true;
          return { running, config: mcp.config };
        },
        disable: async () => {
          running = false;
          return { running, config: null };
        },
        listTools: async () => mcp.tools,
        listPrompts: async () => mcp.prompts,
        listResources: async () => mcp.resources,
        testConnection: async () => mcp.test,
      };
    }
  }, {
    ...options,
    workspace: CAPTURE_WORKSPACE,
    storageDefaults: CAPTURE_STORAGE,
  } as never);
}

export async function openCapture(page: Page, path: string): Promise<void> {
  await page.goto(`/#${path}`);
  await page.waitForLoadState("domcontentloaded");
  await page.addStyleTag({ content: CAPTURE_CSS });
  await page.evaluate(() => document.fonts.ready);
}

/**
 * Opens the fixture workflow the way a person does — clicking its sidebar row,
 * which is what creates the canvas tab. Deep-linking
 * `/:workspace/workflows/:workflowId` lands on the welcome pane instead, so the
 * click is the supported path rather than a workaround.
 */
export async function openWorkflow(page: Page, name: string): Promise<void> {
  await openCapture(page, "/personal/workflows");
  await page.getByRole("button", { name: new RegExp(name) }).first().click();
  await settleCanvas(page);
}

/**
 * Collapses the navigation rail and the workflow sidebar.
 *
 * Both are product controls a user reaches for, and giving the canvas the full
 * window is what lets a crop hold five readable nodes instead of a wide window
 * with a sidebar in it. Non-fatal: a scene whose subject *is* the sidebar
 * simply does not call this.
 */
export async function collapseChrome(page: Page): Promise<void> {
  for (const name of ["Collapse Navigation", "Toggle sidebar"]) {
    await page
      .getByRole("button", { name })
      .first()
      .click({ timeout: 5_000 })
      .catch(() => undefined);
  }
  await page.waitForTimeout(500);
}

/**
 * Frames the whole graph through ReactFlow's own fit-view control.
 *
 * The canvas mounts with `fitView`, but a tab that opens after the nodes are
 * already laid out keeps whatever camera it had — pressing the control is what
 * a person does and it is the only camera state that is reproducible.
 */
export async function fitCanvas(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Fit View" }).click();
  await page.waitForTimeout(600);
}

/**
 * Expands one node in place, through its own Expand control.
 *
 * A collapsed graph is very wide and very short, so a 4:3 or 3:2 crop of it is
 * mostly empty canvas — the exact defect the media brief calls out. An expanded
 * node shows its real configuration and gives the frame vertical mass, which is
 * what "one panel or interaction fills the frame" means here.
 */
export async function expandNode(page: Page, nodeId: string): Promise<void> {
  await page
    .locator(`.react-flow__node[data-id="${nodeId}"]`)
    .getByTitle("Expand")
    .click();
  await page.waitForTimeout(450);
}

/**
 * Waits until a string is actually on screen.
 *
 * Some editors mount late — the request body is Monaco, dynamically imported
 * the first time the Body tab opens — so a scene that needs its text in frame
 * waits for the text rather than for a fixed delay.
 */
export async function waitForVisibleText(
  page: Page,
  needle: string,
): Promise<void> {
  await page.getByText(needle, { exact: false }).first().waitFor();
  await page.waitForTimeout(300);
}

/**
 * Waits until some field on screen holds this text.
 *
 * Header keys and values, URLs and query params are `input` elements, so their
 * content is a live `value` — on screen, but not in any text node and not in
 * the HTML attribute either.
 */
export async function waitForFieldValue(
  page: Page,
  needle: string,
): Promise<void> {
  await page.waitForFunction(
    (text) =>
      Array.from(
        document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
          "input, textarea",
        ),
      ).some((element) => element.value.includes(text)),
    needle,
  );
  await page.waitForTimeout(300);
}

/** Headless UI's dialog panel — the visible surface of any product modal. */
export const MODAL_PANEL = '[id^="headlessui-dialog-panel"]';

/**
 * Opens a node's editor the way the product does: double-click enters focus
 * mode, which is what mounts `NodeModal`. `tab` selects one of the editor's
 * tabs (`Params`, `Headers`, `Body`, `Rules`, …).
 */
export async function openNodeModal(
  page: Page,
  nodeId: string,
  tab?: string,
): Promise<void> {
  await page.locator(`.react-flow__node[data-id="${nodeId}"]`).dblclick();
  // The `role=dialog` element headless UI renders is a zero-size wrapper; the
  // panel inside it is the thing that is visible and the thing a crop frames.
  await page.locator(MODAL_PANEL).waitFor();
  if (tab) {
    // The editor's tab strip is a real `role=tablist`, rendered in the modal
    // shell outside headless UI's panel element, so the click is page-scoped.
    await page.getByRole("tab", { name: tab, exact: true }).first().click();
  }
  await page.waitForTimeout(500);
}

/** Zooms the canvas by pressing ReactFlow's zoom control `steps` times. */
export async function zoomCanvas(page: Page, steps: number): Promise<void> {
  const control = steps > 0 ? "Zoom In" : "Zoom Out";
  for (let index = 0; index < Math.abs(steps); index += 1) {
    await page.getByRole("button", { name: control }).click();
    await page.waitForTimeout(220);
  }
  await page.waitForTimeout(300);
}

export type RunBeat = {
  readonly nodeId: string;
  /** Milliseconds to hold the running state before the terminal one lands. */
  readonly workingMs?: number;
  readonly status?: "passed" | "failed";
  readonly statusCode?: number;
  readonly message?: string;
};

/**
 * Drives a real run through the product's own path: press Run, let the renderer
 * subscribe to the run topic, then release `node.status` events on the scene's
 * clock and hand the finished run to `runs.get`.
 *
 * The canvas paces what it receives itself (`utils/runChoreography.ts`), so the
 * traversal, dwell and camera follow are the shipping behaviour rather than
 * anything this tool animates.
 */
export async function playRun(
  page: Page,
  options: {
    readonly runId: string;
    readonly finishedRun: unknown;
    readonly beats: readonly RunBeat[];
    readonly status?: "completed" | "failed";
    readonly settleMs?: number;
  },
): Promise<void> {
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await page.waitForFunction(
    (runId) => window.__CAPTURE__?.hasListener(runId) === true,
    options.runId,
  );

  await emit(page, { kind: "run.started", runId: options.runId });

  for (const beat of options.beats) {
    await emit(page, {
      kind: "node.status",
      runId: options.runId,
      nodeId: beat.nodeId,
      status: "running",
      variables: {},
    });
    await page.waitForTimeout(beat.workingMs ?? 320);
    await emit(page, {
      kind: "node.status",
      runId: options.runId,
      nodeId: beat.nodeId,
      status: beat.status ?? "passed",
      variables: {},
      ...(beat.statusCode !== undefined ? { statusCode: beat.statusCode } : {}),
      ...(beat.message !== undefined ? { message: beat.message } : {}),
    });
  }

  await page.evaluate((run) => window.__CAPTURE__?.setRun(run), options.finishedRun);
  await emit(page, {
    kind: "run.finished",
    runId: options.runId,
    status: options.status ?? "completed",
  });
  await waitForRunQuiet(page);
  await page.waitForTimeout(options.settleMs ?? 600);
}

/**
 * Waits until the run is over *on screen*, not merely over in the stream.
 *
 * Playback deliberately trails the run (`utils/runChoreography.ts`), and the
 * "Resume follow" pill renders only while a run is still going — so its
 * absence, together with no node left in the running state, is the product's
 * own signal that the canvas has settled and is safe to frame.
 */
export async function waitForRunQuiet(page: Page): Promise<void> {
  await page
    .getByRole("button", { name: "Resume follow" })
    .waitFor({ state: "hidden", timeout: 30_000 })
    .catch(() => undefined);
  await page.waitForFunction(
    () => document.querySelectorAll(".react-flow__node .animate-pulse").length === 0,
    undefined,
    { timeout: 30_000 },
  ).catch(() => undefined);
}

/**
 * Replays one MCP write the way the desktop app receives it: the authoritative
 * post-write snapshot on the workflow-changed channel, which is what makes an
 * agent's edit appear on an open canvas.
 *
 * `runStartedBy` additionally fires the run-started channel, which is what
 * raises the product's own "An agent is running …" notice — the only truthful
 * way to show agent involvement without putting another vendor's terminal UI in
 * an APIWeave frame.
 */
export async function applyAgentWrite(
  page: Page,
  options: {
    readonly workflow: unknown;
    readonly runStartedBy?: { readonly runId: string; readonly workflowId: string; readonly workspaceId: string };
  },
): Promise<void> {
  await page.evaluate((workflow) => window.__CAPTURE__?.setWorkflow(workflow), options.workflow);
  if (options.runStartedBy) {
    await page.evaluate(
      (event) => window.__CAPTURE__?.emitRunStarted(event),
      options.runStartedBy,
    );
  }
  await page.evaluate(
    (workflow) =>
      window.__CAPTURE__?.emitWorkflowChanged({ kind: "upsert", workflow }),
    options.workflow,
  );
  await page.waitForTimeout(1800);
}

async function emit(page: Page, event: Record<string, unknown>): Promise<void> {
  await page.evaluate((payload) => window.__CAPTURE__?.emitRunProgress(payload), event);
}

/** Opens one of the left rail's sections (`Workflows`, `Agents`, `MCP`, …). */
export async function openNav(page: Page, name: string): Promise<void> {
  await page.getByRole("button", { name, exact: true }).first().click();
  await page.waitForTimeout(700);
}

/** Opens the canvas side panel and selects one of its tabs. */
export async function openSidePanel(page: Page, tab: string): Promise<void> {
  await page.getByRole("button", { name: "Show panel" }).click();
  await page.waitForTimeout(400);
  // Variables is the panel's default tab, so selecting it is a no-op the click
  // may not even find; the scene asserts on the content it needs either way.
  await page
    .getByRole("button", { name: tab, exact: true })
    .first()
    .click({ timeout: 4_000 })
    .catch(() => undefined);
  await page.waitForTimeout(500);
}

/**
 * Opens the run timeline for one run, through run history — the only path the
 * product offers. History lives in the toolbar, and moves into the overflow
 * menu when the toolbar is narrow, so both are tried.
 */
export async function openRunTimeline(page: Page, runId: string): Promise<void> {
  const history = page.getByRole("button", { name: "History", exact: true });
  if (await history.isVisible().catch(() => false)) {
    await history.click();
  } else {
    // Narrow toolbar: History moves into the overflow menu, where it is
    // labelled "Run history".
    await page.getByRole("button", { name: "More actions" }).click();
    await page.getByRole("menuitem", { name: "Run history" }).click();
  }
  await page
    .getByRole("button", { name: `View timeline for run ${runId}`, exact: true })
    .click();
  await page.waitForTimeout(800);
}

export type Box = { x: number; y: number; width: number; height: number };

/**
 * The "safe crop" from the media brief, computed rather than hand-tuned.
 *
 * Takes the union of the subject elements, pads it, and grows it to the
 * destination aspect ratio around its own centre. `cssWidth` is a *minimum* —
 * half the destination width, so a crop that needs no growth is captured at
 * exactly 1:1 under `deviceScaleFactor: 2`. When the subject is larger than
 * that, the crop grows to hold all of it and `encode.mjs` resamples down to the
 * destination size; it is never upscaled, and the subject is never clipped.
 *
 * Throws when the subject cannot fit the viewport at all: a silently shrunk
 * crop is how a node ends up cut off at the frame edge, which is the exact
 * defect this phase exists to remove.
 */
export async function safeCrop(
  page: Page,
  selectors: readonly string[],
  opts: { aspect: number; cssWidth: number; pad?: number },
): Promise<Box> {
  const pad = opts.pad ?? 16;
  const measured = await page.evaluate((sel) => {
    let left = Infinity;
    let top = Infinity;
    let right = -Infinity;
    let bottom = -Infinity;
    const missing: string[] = [];
    for (const selector of sel) {
      let matched = false;
      for (const element of document.querySelectorAll(selector)) {
        const rect = element.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) continue;
        matched = true;
        left = Math.min(left, rect.left);
        top = Math.min(top, rect.top);
        right = Math.max(right, rect.right);
        bottom = Math.max(bottom, rect.bottom);
      }
      if (!matched) missing.push(selector);
    }
    return {
      missing,
      box: Number.isFinite(left) ? { left, top, right, bottom } : null,
    };
  }, selectors);

  // The canvas runs with `onlyRenderVisibleElements`, so a node outside the
  // current camera is not in the DOM at all. Without this check the union would
  // quietly be the box of whichever subjects happened to be on screen, and the
  // crop would ship missing its subject.
  if (measured.missing.length > 0) {
    throw new Error(
      `safeCrop: nothing rendered for ${measured.missing.join(", ")} — the ` +
        "subject is outside the camera, or the selector is wrong",
    );
  }
  const union = measured.box;
  if (union === null) {
    throw new Error(`safeCrop: no element matched ${selectors.join(", ")}`);
  }

  const viewport = page.viewportSize();
  if (viewport === null) throw new Error("safeCrop: no viewport");

  // A crop whose subject is on the canvas must stay on the canvas. Without
  // this, a crop clamped against the left edge of the window pulls the nav rail
  // or the sidebar into frame — and at a narrow viewport it can lay that strip
  // straight over the subject.
  const canvas = await page.evaluate(() => {
    const element = document.querySelector(".react-flow");
    if (element === null) return null;
    const rect = element.getBoundingClientRect();
    return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
  });
  let bounds =
    canvas !== null &&
    union.left >= canvas.left &&
    union.top >= canvas.top &&
    union.right <= canvas.right &&
    union.bottom <= canvas.bottom
      ? { ...canvas }
      : { left: 0, top: 0, right: viewport.width, bottom: viewport.height };

  // At a narrow viewport the nav rail and the workflow sidebar sit *over* the
  // canvas, so the canvas box alone is not the visible area. Pull the left edge
  // in past whichever of them overlaps, unless the subject itself is under
  // there — in which case the frame is wrong and the containment check below
  // should say so rather than this quietly cropping around it.
  const overlays = await page.evaluate(() =>
    ['nav[aria-label="Main navigation"]', '[aria-label="Sidebar"]']
      .map((selector) => document.querySelector(selector))
      .filter((element): element is Element => element !== null)
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return { left: rect.left, right: rect.right, width: rect.width };
      }),
  );
  for (const overlay of overlays) {
    if (overlay.width === 0) continue;
    if (overlay.right > bounds.left && overlay.left <= bounds.left && union.left >= overlay.right) {
      bounds = { ...bounds, left: overlay.right };
    }
  }

  let width = Math.max(opts.cssWidth, union.right - union.left + pad * 2);
  let height = Math.max(opts.cssWidth / opts.aspect, union.bottom - union.top + pad * 2);
  if (width / height > opts.aspect) height = width / opts.aspect;
  else width = height * opts.aspect;

  const boundsWidth = bounds.right - bounds.left;
  const boundsHeight = bounds.bottom - bounds.top;
  if (width > boundsWidth || height > boundsHeight) {
    throw new Error(
      `safeCrop: the ${Math.ceil(width)}x${Math.ceil(height)} crop needed for ` +
        `${selectors.join(", ")} does not fit the ${Math.round(boundsWidth)}x` +
        `${Math.round(boundsHeight)} area available — zoom the subject out, or ` +
        "give the scene a larger viewport",
    );
  }

  const centreX = (union.left + union.right) / 2;
  const centreY = (union.top + union.bottom) / 2;
  const box = {
    x: clamp(centreX - width / 2, bounds.left, bounds.right - width),
    y: clamp(centreY - height / 2, bounds.top, bounds.bottom - height),
    width,
    height,
  };

  // Clamping keeps the crop inside the viewport, and a subject sitting near an
  // edge can be pushed out by it. Sizing alone is not the guarantee — this is.
  const contains =
    union.left >= box.x - 0.5 &&
    union.top >= box.y - 0.5 &&
    union.right <= box.x + box.width + 0.5 &&
    union.bottom <= box.y + box.height + 0.5;
  if (!contains) {
    throw new Error(
      `safeCrop: the crop had to be clamped to its bounds and no longer ` +
        `contains ${selectors.join(", ")} — move the subject towards the ` +
        "centre of the canvas before framing it",
    );
  }
  return box;
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) throw new Error("safeCrop: crop is larger than the viewport");
  return Math.min(Math.max(value, min), max);
}

/** Waits for the canvas to settle: nodes mounted, edges drawn, fitView done. */
export async function settleCanvas(page: Page): Promise<void> {
  await page.waitForSelector(".react-flow__node");
  // No edge assertion here: the canvas runs with `onlyRenderVisibleElements`,
  // so before the camera settles there may be no edge in view to wait for.
  await page.waitForFunction(() => {
    const viewport = document.querySelector<HTMLElement>(".react-flow__viewport");
    return viewport !== null && viewport.style.transform.length > 0;
  });
  await page.waitForTimeout(400);
}
