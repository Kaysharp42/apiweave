import { test, expect } from "@playwright/test";
import {
  mockApiRoutes,
  navigateAndWait,
  captureEvidence,
} from "./fixtures/auth";

/**
 * unauthorized.spec.ts — Direct URL to unauthorized workspace shows 404, no data leak.
 *
 * Verifies:
 * 1. Unknown workspace slug shows NotFoundPage
 * 2. No sensitive data is leaked in the 404 page
 * 3. User can navigate back to a valid page
 */

test.describe("Unauthorized Access", () => {
  test("unknown workspace shows 404 page", async ({ page }) => {
    await mockApiRoutes(page);
    await navigateAndWait(page, "/unknown-org/unknown-ws/workflows");

    // Should show the NotFoundPage
    await expect(page.locator("body")).toContainText("Page not found");

    // Should show the path that was not found
    await expect(page.locator("body")).toContainText("/unknown-org/unknown-ws");

    await captureEvidence(page, "task-30-unauthorized-404.png");
  });

  test("404 page has no data leak", async ({ page }) => {
    await mockApiRoutes(page);
    await navigateAndWait(page, "/unknown-org/unknown-ws/workflows");

    // Should NOT contain any sensitive data
    const bodyText = await page.locator("body").textContent();
    expect(bodyText).not.toContain("usr-test-001");
    expect(bodyText).not.toContain("owner@example.com");
    expect(bodyText).not.toContain("org-test-001");
    expect(bodyText).not.toContain("ws-org-001");

    await captureEvidence(page, "task-30-unauthorized-no-leak.png");
  });

  test("404 page has navigation back", async ({ page }) => {
    await mockApiRoutes(page);
    await navigateAndWait(page, "/unknown-org/unknown-ws/workflows");

    // Should have a "Go to Workflows" button
    const goBtn = page.getByRole("button", { name: /Go to Workflows/i });
    await expect(goBtn).toBeVisible();

    await captureEvidence(page, "task-30-unauthorized-nav.png");
  });

  test("unknown project shows not found", async ({ page }) => {
    await mockApiRoutes(page);
    await navigateAndWait(page, "/acme/main/projects/nonexistent-project");

    // Should show project not found or page not found
    const bodyText = await page.locator("body").textContent();
    const hasNotFound =
      bodyText?.includes("not found") ||
      bodyText?.includes("Page not found") ||
      bodyText?.includes("Project not found") ||
      bodyText?.includes("Workspace not found");
    expect(hasNotFound).toBeTruthy();

    await captureEvidence(page, "task-30-unauthorized-project.png");
  });
});
