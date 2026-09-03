import { expect, test, type Page } from "@playwright/test";
import {
  DESKTOP_WORKFLOW,
  DESKTOP_WORKSPACE,
  installDesktopIpc,
} from "./fixtures/desktop";

/**
 * Undo/redo on the real canvas (#13).
 *
 * The unit tests cover what belongs in the ring; this covers the wiring that
 * unit tests cannot see — that the ring's baseline is the *hydrated* graph and
 * not the seed `start` node, and that Ctrl+Z reaches the canvas at all.
 *
 * Autosave is off for the run: the IPC mock echoes a static workflow back from
 * `workflows.update`, so a save here would re-hydrate the deleted node and the
 * assertion would pass for the wrong reason.
 */

const WORKFLOW_ID = "wf-canvas-undo";
const WORKFLOW = {
  ...DESKTOP_WORKFLOW,
  workflowId: WORKFLOW_ID,
  name: "Undo wiring",
  nodes: [
    ...DESKTOP_WORKFLOW.nodes,
    {
      nodeId: "request-2",
      type: "http-request",
      label: "Get orders",
      position: { x: 560, y: 140 },
      config: {
        method: "GET",
        url: "https://api.example.com/orders",
        queryParams: [],
        headers: [],
        cookies: [],
        bodyType: "json",
        body: "",
        timeout: 30,
        followRedirects: true,
        sslVerify: true,
        continueOnFail: false,
      },
    },
  ],
} as const;

async function openCanvas(page: Page): Promise<void> {
  await installDesktopIpc(page, {
    workflow: WORKFLOW,
    // Autosave off: the IPC mock echoes a static workflow back from
    // `workflows.update`, so a save would re-hydrate the canvas from the
    // fixture and undo the edit this test just made.
    storage: { "apiweave:v1:autoSaveEnabled": "false" },
  });

  await page.goto(`/#/${DESKTOP_WORKSPACE.slug}/workflows/${WORKFLOW_ID}`, {
    waitUntil: "domcontentloaded",
  });

  // The route alone does not mount the canvas — the workflow has to be opened
  // from the sidebar list, which is what seeds WorkflowContext.
  const entry = page.getByRole("button", { name: /Undo wiring/ }).first();
  await entry.waitFor({ state: "visible", timeout: 30_000 });
  await entry.click();
  await page.waitForSelector(".react-flow__node", { timeout: 30_000 });
}

test.describe("canvas undo", () => {
  test("undoes and redoes a node deletion", async ({ page }) => {
    await openCanvas(page);

    const nodes = page.locator(".react-flow__node");
    const undo = page.getByRole("button", { name: "Undo", exact: true });
    const redo = page.getByRole("button", { name: "Redo", exact: true });

    await expect(nodes).toHaveCount(3);
    // Nothing to undo yet: the hydrated graph is the baseline, not an edit.
    await expect(undo).toBeDisabled();
    await expect(redo).toBeDisabled();

    await page.locator('.react-flow__node[data-id="request-2"]').click();
    await page.keyboard.press("Delete");
    await expect(nodes).toHaveCount(2);

    // Enabling is the debounced record landing — the ring now has the edit.
    await expect(undo).toBeEnabled();

    await undo.click();
    await expect(nodes).toHaveCount(3);
    await expect(undo).toBeDisabled();

    await redo.click();
    await expect(nodes).toHaveCount(2);

    await page.keyboard.press("Control+z");
    await expect(nodes).toHaveCount(3);
  });
});
