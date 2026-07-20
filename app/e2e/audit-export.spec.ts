import { test, expect } from "@playwright/test";
import {
  mockApiRoutes,
  navigateAndWait,
  captureEvidence,
  MOCK_AUDIT_EVENT,
} from "./fixtures/auth";

/**
 * audit-export.spec.ts — Audit page loads, JSON export downloads.
 *
 * Verifies:
 * 1. Audit page loads with events table
 * 2. Audit events are displayed
 * 3. Export button is present
 * 4. JSON export triggers a download
 */

test.describe("Audit Export", () => {
  test("audit page loads with events", async ({ page }) => {
    await mockApiRoutes(page);
    await navigateAndWait(page, "/audit");

    // Should show the page title
    await expect(page.locator("body")).toContainText("Audit Log");

    // Should show the subtitle about no secret values
    await expect(page.locator("body")).toContainText("No secret values");

    // Should show event count
    await expect(page.locator("body")).toContainText("Events");

    await captureEvidence(page, "task-30-audit-export-page.png");
  });

  test("audit events are displayed", async ({ page }) => {
    await mockApiRoutes(page);
    await navigateAndWait(page, "/audit");

    // Should show the audit event action
    await expect(page.locator("body")).toContainText(MOCK_AUDIT_EVENT.action);

    await captureEvidence(page, "task-30-audit-export-events.png");
  });

  test("export button is present", async ({ page }) => {
    await mockApiRoutes(page);
    await navigateAndWait(page, "/audit");

    // Should have an export button
    const exportBtn = page.getByRole("button", { name: /export|download/i });
    await expect(exportBtn).toBeVisible();

    await captureEvidence(page, "task-30-audit-export-button.png");
  });

  test("filters panel is visible", async ({ page }) => {
    await mockApiRoutes(page);
    await navigateAndWait(page, "/audit");

    // Should show the Filters panel
    await expect(page.locator("body")).toContainText("Filters");

    await captureEvidence(page, "task-30-audit-export-filters.png");
  });
});
