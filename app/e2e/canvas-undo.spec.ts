import { expect, test, type Page } from "@playwright/test";
import { DESKTOP_WORKFLOW, DESKTOP_WORKSPACE } from "./fixtures/desktop";

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
  await page.addInitScript(
    ({ workflow, workspace }) => {
      localStorage.setItem("apiweave:v1:autoSaveEnabled", "false");
      localStorage.setItem("autoSaveEnabled", "false");
      window.__APIWEAVE_IPC__ = {
        invoke: async (domain: string, action: string) => {
          if (domain === "workspaces" && action === "list")
            return { ok: true as const, data: [workspace] };
          if (domain === "workflows" && action === "list")
            return { ok: true as const, data: { items: [workflow], total: 1 } };
          if (domain === "workflows")
            return { ok: true as const, data: workflow };
          if (domain === "settings" && action === "get")
            return { ok: true as const, data: { allowPrivateNetworks: false } };
          if (domain === "secrets" && action === "list")
            return { ok: true as const, data: [] };
          if (domain === "runs" && action.startsWith("getLatest"))
            return { ok: true as const, data: null };
          return { ok: true as const, data: { items: [], total: 0 } };
        },
        onRunProgress: () => () => undefined,
        onCloudStatusChanged: () => () => undefined,
        onWorkflowChanged: () => () => undefined,
      };
    },
    { workflow: WORKFLOW, workspace: DESKTOP_WORKSPACE },
  );

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
