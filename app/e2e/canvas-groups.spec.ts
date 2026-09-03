import { expect, test, type Page } from "@playwright/test";
import {
  DESKTOP_WORKFLOW,
  DESKTOP_WORKSPACE,
  captureEvidence,
  installDesktopIpc,
} from "./fixtures/desktop";

/**
 * Group frames on the real canvas (#4).
 *
 * The unit tests own the geometry. What only the real canvas can answer is
 * whether React Flow's `parentId` is doing the work this feature leans on: the
 * frame moves its members with it and no drag handler of ours does that, and a
 * frame does not eat the clicks aimed at what is inside it.
 */

const WORKFLOW_ID = "wf-canvas-groups";
const WORKFLOW = {
  ...DESKTOP_WORKFLOW,
  workflowId: WORKFLOW_ID,
  name: "Frame wiring",
  nodes: DESKTOP_WORKFLOW.nodes,
} as const;

async function openCanvas(
  page: Page,
  workflow: unknown = WORKFLOW,
  dark = false,
): Promise<void> {
  await installDesktopIpc(page, {
    workflow,
    // Autosave off: the IPC mock echoes a static workflow back from
    // `workflows.update`, so a save would re-hydrate the canvas from the
    // fixture and undo the edit this test just made.
    storage: {
      "apiweave:v1:autoSaveEnabled": "false",
      ...(dark ? { "apiweave:v1:darkMode": "true" } : {}),
    },
  });

  await page.goto(`/#/${DESKTOP_WORKSPACE.slug}/workflows/${WORKFLOW_ID}`, {
    waitUntil: "domcontentloaded",
  });
  const entry = page.getByRole("button", { name: /Frame wiring/ }).first();
  await entry.waitFor({ state: "visible", timeout: 30_000 });
  await entry.click();
  await page.waitForSelector(".react-flow__node", { timeout: 30_000 });

  // The graph starts under the sidebar; give the canvas the window so a click
  // lands on a node rather than on the workflow list.
  for (const label of ["Collapse sidebar", "Collapse Navigation"]) {
    const button = page.getByRole("button", { name: label }).first();
    if (await button.count()) await button.click().catch(() => undefined);
  }
  const fit = page.locator(".react-flow__controls-fitview").first();
  if (await fit.count()) await fit.click({ force: true });
  await page.waitForTimeout(600);
}

/** Top-left of a node in page coordinates. */
async function corner(page: Page, id: string): Promise<{ x: number; y: number }> {
  const box = await page.locator(`.react-flow__node[data-id="${id}"]`).boundingBox();
  if (!box) throw new Error(`node ${id} has no box`);
  return { x: box.x, y: box.y };
}

async function selectBoth(page: Page): Promise<void> {
  await page.locator('.react-flow__node[data-id="start-1"]').click();
  await page
    .locator('.react-flow__node[data-id="request-1"]')
    .click({ modifiers: ["Shift"] });
}

test.describe("group frames", () => {
  test("frames a selection, carries its members, and lets them go", async ({
    page,
  }) => {
    await openCanvas(page);

    const frame = page.locator(".react-flow__node-group");
    const before = {
      start: await corner(page, "start-1"),
      request: await corner(page, "request-1"),
    };

    await selectBoth(page);
    await page.keyboard.press("Control+g");
    await expect(frame).toHaveCount(1);

    // A frame must not swallow the clicks aimed at what is inside it — that is
    // what `pointer-events: none` on the wrapper buys, and what lets a box
    // selection start inside a frame.
    await expect(frame).toHaveCSS("pointer-events", "none");

    // Drag the frame by its pill: React Flow moves the members, no handler of
    // ours does.
    const pill = page.locator(".aw-group-handle");
    const pillBox = await pill.boundingBox();
    if (!pillBox) throw new Error("the frame has no drag handle");
    await page.mouse.move(pillBox.x + pillBox.width / 2, pillBox.y + pillBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(pillBox.x + pillBox.width / 2 + 120, pillBox.y + pillBox.height / 2 + 60, { steps: 8 });
    await page.mouse.up();

    const moved = {
      start: await corner(page, "start-1"),
      request: await corner(page, "request-1"),
    };
    expect(moved.start.x - before.start.x).toBeGreaterThan(80);
    expect(moved.request.x - before.request.x).toBeGreaterThan(80);
    // Both by the same amount: the frame moved, the graph inside it did not.
    expect(
      Math.abs(
        moved.start.x - before.start.x - (moved.request.x - before.request.x),
      ),
    ).toBeLessThan(2);

    // Ungroup leaves every member exactly where it looks.
    await page.locator('.react-flow__node[data-id="start-1"]').click();
    await page.keyboard.press("Control+Shift+g");
    await expect(frame).toHaveCount(0);

    const freed = await corner(page, "start-1");
    expect(Math.abs(freed.x - moved.start.x)).toBeLessThan(2);
  });
  // ReactFlow's own delete pass takes every child of a deleted parent with it.
  // For a frame that reads the gesture backwards: deleting the box around some
  // nodes should leave the nodes.
  test("deleting a frame keeps its members", async ({ page }) => {
    await openCanvas(page);
    const nodes = page.locator(".react-flow__node");
    const frame = page.locator(".react-flow__node-group");

    await selectBoth(page);
    await page.keyboard.press("Control+g");
    await expect(frame).toHaveCount(1);
    await expect(nodes).toHaveCount(3);

    const before = await corner(page, "request-1");
    await page.locator(".aw-group-handle").click();
    await page.keyboard.press("Delete");

    await expect(frame).toHaveCount(0);
    await expect(nodes).toHaveCount(2);
    // And exactly where it looked, not back at the frame's origin.
    const after = await corner(page, "request-1");
    expect(Math.abs(after.x - before.x)).toBeLessThan(2);
    expect(Math.abs(after.y - before.y)).toBeLessThan(2);
  });
  // Opening a *saved* framed workflow is the path real use takes, and the one
  // the adapter owns: `config.width/height` back onto the node, `parentId` plus
  // `extent`, frames hoisted ahead of their members.
  test("renders a persisted frame at its stored size", async ({ page }) => {
    const saved = {
      ...WORKFLOW,
      nodes: [
        ...WORKFLOW.nodes.map((node) =>
          node.nodeId === "request-1"
            ? { ...node, parentId: "group-1", position: { x: 60, y: 70 } }
            : node,
        ),
        {
          nodeId: "group-1",
          type: "group",
          label: "Users API",
          position: { x: 300, y: 60 },
          config: { width: 460, height: 300, color: "violet" },
        },
      ],
    };

    await openCanvas(page, saved, true);

    const frame = page.locator(".react-flow__node-group");
    await expect(frame).toHaveCount(1);
    await expect(page.locator(".aw-group-handle")).toContainText("Users API");

    // Zoom-independent: compare the frame's box against a member's, both in
    // page pixels, rather than asserting 460 after a fitView.
    const frameBox = (await frame.boundingBox())!;
    const memberBox = (await page
      .locator('.react-flow__node[data-id="request-1"]')
      .boundingBox())!;
    expect(memberBox.x).toBeGreaterThan(frameBox.x);
    expect(memberBox.x + memberBox.width).toBeLessThan(
      frameBox.x + frameBox.width,
    );
    expect(frameBox.width / frameBox.height).toBeCloseTo(460 / 300, 1);

    await captureEvidence(page, "canvas-group-frame-dark.png");
  });
});
