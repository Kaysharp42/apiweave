import { test, expect } from "@playwright/test";
import {
  mockApiRoutes,
  mockUnauthenticated,
  navigateAndWait,
  captureEvidence,
} from "./fixtures/auth";

test.describe("Setup — First owner bootstrap", () => {
  test("unauthenticated user sees login page", async ({ page }) => {
    await mockUnauthenticated(page);
    await navigateAndWait(page, "/login");

    await expect(page).toHaveURL(/\/login/);
    await expect(page.locator("body")).not.toBeEmpty();

    const heading = page.locator("h1, h2").first();
    await expect(heading).toBeVisible();

    await captureEvidence(page, "task-30-setup-login.png");
  });

  test("setup page renders for first-time admin", async ({ page }) => {
    await mockUnauthenticated(page);
    await navigateAndWait(page, "/setup");

    await expect(page).toHaveURL(/\/setup/);
    await expect(page.locator("body")).not.toBeEmpty();

    const heading = page.getByText("Setup APIWeave");
    await expect(heading).toBeVisible();

    await captureEvidence(page, "task-30-setup-page.png");
  });

  test("authenticated user sees personal workspace", async ({ page }) => {
    await mockApiRoutes(page);
    await navigateAndWait(page, "/personal/personal/workflows");

    await expect(page).toHaveURL(/\/personal\/personal\/workflows/);

    const switcher = page.locator('[aria-label="Switch workspace"]');
    await expect(switcher).toBeVisible();

    await captureEvidence(page, "task-30-setup-bootstrap.png");
  });

  test("personal workspace shows workflows page", async ({ page }) => {
    await mockApiRoutes(page);
    await navigateAndWait(page, "/personal/personal/workflows");

    const header = page.locator("header");
    await expect(header).toBeVisible();

    const switcher = page.locator('[aria-label="Switch workspace"]');
    await expect(switcher).toBeVisible();
    await expect(switcher).toContainText("Personal");

    await captureEvidence(page, "task-30-setup-personal-workflows.png");
  });
});
