import { expect, test } from "@playwright/test";
import { installDesktopIpc, navigateDesktop } from "./fixtures/desktop";

test("merge choices preserve row geometry and keep arrows clear of scrollable values", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await installDesktopIpc(page);
  await page.addInitScript(() => {
    const bridge = window.__APIWEAVE_IPC__;
    if (!bridge) throw new Error("Missing desktop fixture");
    const invoke = bridge.invoke;
    bridge.invoke = async (domain, action, payload) => {
      if (domain === "cloud" && action === "conflict-get") {
        return { ok: true, data: {
          id: "merge-layout", workspace_id: "workspace-personal", kind: "workflow",
          record_id: "workflow-smoke", name: "Merge layout", local_rev: 2, cloud_rev: 3,
          winner: null, auto_mergeable: true, merge_residual_paths: [],
          created_at: "2026-09-10T00:00:00Z",
          local_payload: { name: "Local", nodes: [], edges: [], variables: { body: "short", ...Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`field${i}`, i])) } },
          cloud_payload: { name: "Cloud", nodes: [], edges: [], variables: { body: Array.from({ length: 30 }, (_, i) => `Line ${i}: incoming content`).join("\n"), ...Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`field${i}`, i + 1])) } },
        } };
      }
      return invoke(domain, action, payload);
    };
  });
  await navigateDesktop(page, "/cloud/conflicts/merge-layout");
  const arrow = page.getByRole("button", { name: /Accept Cloud for.*Body/ });
  await arrow.scrollIntoViewIfNeeded();
  const row = page.getByRole("listitem").filter({ has: page.locator("code", { hasText: "variables.body" }) });
  const before = await row.boundingBox();
  const value = row.locator("pre").first();
  const valueBox = await value.boundingBox();
  const arrowBox = await arrow.boundingBox();
  expect(before).not.toBeNull();
  expect(valueBox).not.toBeNull();
  expect(arrowBox).not.toBeNull();
  expect(valueBox!.x + valueBox!.width).toBeLessThan(arrowBox!.x);
  await arrow.click();
  expect(await row.boundingBox()).toEqual(before);
  await row.getByRole("button", { name: /Accept Local/ }).click();
  expect(await row.boundingBox()).toEqual(before);
  await row.getByRole("button", { name: /Reset selection/ }).click();
  expect(await row.boundingBox()).toEqual(before);
  await page.getByRole("button", { name: /Accept Cloud for.*Field9/ }).scrollIntoViewIfNeeded();
  await expect(page.getByText("Incoming · revision 3 · an unknown author")).toBeInViewport();
  await expect(page.getByRole("button", { name: "Apply merge to workspace" })).toBeInViewport();
  await page.setViewportSize({ width: 760, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
