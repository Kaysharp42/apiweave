import { expect, test, type Page } from "@playwright/test";
import {
  DESKTOP_WORKFLOW,
  DESKTOP_WORKSPACE,
  installDesktopIpc,
} from "./fixtures/desktop";

/**
 * `{{…}}` completion on the real canvas.
 *
 * The unit tests own the matching, the insertion and the keyboard. What only a
 * real canvas can show is where the popover lands: a node's slab is
 * `overflow-hidden` and sits inside ReactFlow's transformed viewport, so a list
 * rendered in the field's own subtree is clipped by the node it is helping
 * with. This asserts the list is on screen and wider than the node it belongs
 * to — which it cannot be if the portal is ever dropped.
 */

const WORKFLOW_ID = "wf-template-autocomplete";
const WORKFLOW = {
  ...DESKTOP_WORKFLOW,
  workflowId: WORKFLOW_ID,
  name: "Reference completion",
  variables: { authToken: "abc123", orderId: 42 },
} as const;

async function openExpandedNode(page: Page): Promise<void> {
  await installDesktopIpc(page, {
    workflow: WORKFLOW,
    // Autosave off: the mock echoes the fixture back from `workflows.update`,
    // which would re-hydrate the field mid-edit.
    storage: { "apiweave:v1:autoSaveEnabled": "false" },
  });

  await page.goto(`/#/${DESKTOP_WORKSPACE.slug}/workflows/${WORKFLOW_ID}`, {
    waitUntil: "domcontentloaded",
  });

  const entry = page
    .getByRole("button", { name: /Reference completion/ })
    .first();
  await entry.waitFor({ state: "visible", timeout: 30_000 });
  await entry.click();
  await page.waitForSelector(".react-flow__node", { timeout: 30_000 });

  // Fit first: at the seeded positions the node sits under the canvas
  // toolbar, which swallows the click on its expander.
  const fit = page.locator(".react-flow__controls-fitview").first();
  if (await fit.count()) await fit.click({ force: true });
  await page.waitForTimeout(600);

  await page
    .locator('.react-flow__node[data-id="request-1"]')
    .getByRole("button", { name: /Expand/ })
    .first()
    .click();
}

test.describe("template autocomplete", () => {
  test("offers a workflow variable and escapes the node's clipping", async ({
    page,
  }) => {
    await openExpandedNode(page);

    const url = page.getByLabel("Request URL");
    await url.click();
    await url.fill("https://api.example.com/orders/");
    await url.pressSequentially("{{order");

    const list = page.getByRole("listbox", { name: "Reference suggestions" });
    await expect(list).toBeVisible();

    const option = page.getByRole("option", { name: /variables\.orderId/ });
    await expect(option).toBeVisible();

    // The invariant: the list lives outside the node's subtree. Inside it, the
    // slab's `overflow-hidden` would cut it off at the node's edge.
    expect(
      await list.evaluate((element) =>
        Boolean(element.closest(".react-flow__node")),
      ),
    ).toBe(false);

    // …and it is anchored to the field it is completing, on screen.
    const listBox = (await list.boundingBox())!;
    const fieldBox = (await url.boundingBox())!;
    const gapBelow = listBox.y - (fieldBox.y + fieldBox.height);
    const gapAbove = fieldBox.y - (listBox.y + listBox.height);
    expect(listBox.height).toBeGreaterThan(20);
    // Sits against the field on one side or the other, never over it.
    expect(Math.max(gapBelow, gapAbove)).toBeGreaterThanOrEqual(0);
    expect(Math.max(gapBelow, gapAbove)).toBeLessThan(24);
    expect(listBox.y).toBeGreaterThanOrEqual(0);
    expect(listBox.y + listBox.height).toBeLessThanOrEqual(
      page.viewportSize()!.height,
    );

    await option.click();
    await expect(url).toHaveValue(
      "https://api.example.com/orders/{{variables.orderId}}",
    );
    await expect(list).toBeHidden();
  });
});
