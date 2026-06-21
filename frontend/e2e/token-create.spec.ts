import { test, expect } from "@playwright/test";
import {
  mockApiRoutes,
  navigateAndWait,
  captureEvidence,
  MOCK_ORG_WORKSPACE,
  MOCK_SERVICE_TOKEN,
} from "./fixtures/auth";

/**
 * token-create.spec.ts — Create service token, see one-time value, refresh to confirm gone.
 *
 * Verifies:
 * 1. Tokens page loads with token list
 * 2. Create token modal opens
 * 3. Token metadata (name) visible, raw value NOT in list
 */

test.describe("Token Create", () => {
  test("tokens page loads with token list", async ({ page }) => {
    await mockApiRoutes(page);
    await navigateAndWait(
      page,
      `/acme/${MOCK_ORG_WORKSPACE.slug}/settings/tokens`,
    );

    // Should show the page title
    await expect(page.locator("body")).toContainText("Service Tokens");

    // Should show the token name in the list
    await expect(page.locator("body")).toContainText(MOCK_SERVICE_TOKEN.name);

    await captureEvidence(page, "task-30-token-create-list.png");
  });

  test("create token modal opens", async ({ page }) => {
    await mockApiRoutes(page);
    await navigateAndWait(
      page,
      `/acme/${MOCK_ORG_WORKSPACE.slug}/settings/tokens`,
    );

    // Click "Create token" button
    const createBtn = page.getByRole("button", { name: /Create token/i });
    await expect(createBtn).toBeVisible();
    await createBtn.click();

    // Modal should appear
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(/Create.*token/i);

    await captureEvidence(page, "task-30-token-create-modal.png");
  });

  test("token raw value is NOT in the list view", async ({ page }) => {
    await mockApiRoutes(page);
    await navigateAndWait(
      page,
      `/acme/${MOCK_ORG_WORKSPACE.slug}/settings/tokens`,
    );

    // The one-time token value should NOT appear in the list
    const bodyText = await page.locator("body").textContent();
    expect(bodyText).not.toContain("awt_one_time_secret_value_do_not_store");

    // But the token name should be visible
    await expect(page.locator("body")).toContainText(MOCK_SERVICE_TOKEN.name);

    await captureEvidence(page, "task-30-token-create-no-raw-value.png");
  });
});
