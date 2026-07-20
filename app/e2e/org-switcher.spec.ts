import { test, expect } from "@playwright/test";
import {
  mockApiRoutes,
  navigateAndWait,
  captureEvidence,
  MOCK_ORG,
  MOCK_ORG_WORKSPACE,
} from "./fixtures/auth";

/**
 * org-switcher.spec.ts — Organization/workspace switcher.
 *
 * Verifies:
 * 1. Switcher dropdown opens on click
 * 2. Shows personal and org workspaces
 * 3. Switching to a workspace updates the URL
 * 4. Current workspace is highlighted
 */

test.describe("Org Workspace Switcher", () => {
  test("switcher opens and shows workspaces", async ({ page }) => {
    await mockApiRoutes(page);
    await navigateAndWait(page, "/personal/personal/workflows");

    // Click the switcher to open dropdown
    const switcher = page.locator('[aria-label="Switch workspace"]');
    await expect(switcher).toBeVisible();
    await switcher.click();

    // Dropdown should appear with listbox role
    const listbox = page.locator('[role="listbox"]');
    await expect(listbox).toBeVisible();

    // Should show "Switch workspace" header
    await expect(listbox).toContainText("Switch workspace");

    // Should show Personal workspace
    await expect(listbox).toContainText("Personal");

    // Should show org workspace
    await expect(listbox).toContainText(MOCK_ORG_WORKSPACE.name);

    await captureEvidence(page, "task-30-org-switcher-open.png");
  });

  test("switching to org workspace updates URL", async ({ page }) => {
    await mockApiRoutes(page);
    await navigateAndWait(page, "/personal/workflows");

    // Open switcher
    const switcher = page.locator('[aria-label="Switch workspace"]');
    await switcher.click();

    // Click on the org workspace option
    const orgOption = page
      .locator('[role="option"]')
      .filter({ hasText: MOCK_ORG_WORKSPACE.name });
    await orgOption.click();

    // URL should update to the org workspace
    await expect(page).toHaveURL(
      new RegExp(`/${MOCK_ORG.slug}/${MOCK_ORG_WORKSPACE.slug}/workflows`),
    );

    await captureEvidence(page, "task-30-org-switcher-switched.png");
  });

  test("current workspace is highlighted in dropdown", async ({ page }) => {
    await mockApiRoutes(page);
    await navigateAndWait(page, `/acme/${MOCK_ORG_WORKSPACE.slug}/workflows`);

    // Open switcher
    const switcher = page.locator('[aria-label="Switch workspace"]');
    await switcher.click();

    // The active option should have aria-selected="true"
    const activeOption = page.locator('[role="option"][aria-selected="true"]');
    await expect(activeOption).toBeVisible();

    await captureEvidence(page, "task-30-org-switcher-active.png");
  });

  test("switcher closes on Escape", async ({ page }) => {
    await mockApiRoutes(page);
    await navigateAndWait(page, "/personal/personal/workflows");

    const switcher = page.locator('[aria-label="Switch workspace"]');
    await switcher.click();

    const listbox = page.locator('[role="listbox"]');
    await expect(listbox).toBeVisible();

    // Press Escape
    await page.keyboard.press("Escape");

    // Dropdown should close
    await expect(listbox).not.toBeVisible();
  });
});
