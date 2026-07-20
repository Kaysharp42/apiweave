import { expect, test } from "@playwright/test";
import {
  DESKTOP_WORKFLOW,
  installDesktopIpc,
  navigateDesktop,
} from "./fixtures/desktop";

test.describe("desktop renderer smoke", () => {
  test.beforeEach(async ({ page }) => {
    await installDesktopIpc(page);
  });

  test("boots through the IPC bridge into the personal workspace", async ({
    page,
  }) => {
    await navigateDesktop(page, "/app");

    await expect(page).toHaveURL(/#\/personal\/workflows$/);
    await expect(
      page.getByRole("button", { name: new RegExp(DESKTOP_WORKFLOW.name) }),
    ).toBeVisible();
  });

  test("opens a canonical workflow on the ReactFlow canvas", async ({ page }) => {
    await navigateDesktop(page, "/personal/workflows");

    await page
      .getByRole("button", { name: new RegExp(DESKTOP_WORKFLOW.name) })
      .click();

    const canvas = page.getByRole("main", { name: "Workflow canvas" });
    await expect(canvas.locator(".react-flow__node")).toHaveCount(2);
    await expect(canvas.getByText("Get users", { exact: true })).toBeVisible();
  });

  test("renders the desktop shell at a narrow viewport", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await navigateDesktop(page, "/personal/workflows");

    await expect(page.locator("header").first()).toBeVisible();
    await expect(page.locator("body")).not.toBeEmpty();
  });

  test("shows a safe not-found page for unknown desktop routes", async ({
    page,
  }) => {
    await navigateDesktop(page, "/missing-route");

    await expect(
      page.getByRole("heading", { name: "Not found" }),
    ).toBeVisible();
    await expect(page.locator("body")).not.toContainText(
      "local@apiweave.desktop",
    );
  });
});
