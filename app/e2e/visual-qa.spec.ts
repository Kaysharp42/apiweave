import { test, expect } from "@playwright/test";
import {
  mockApiRoutes,
  navigateAndWait,
  MOCK_ORG,
  MOCK_ORG_WORKSPACE,
} from "./fixtures/auth";

/**
 * visual-qa.spec.ts — Capture pages at desktop (1280px) and narrow (375px) widths.
 *
 * Captures screenshots for visual QA of all management screens.
 * No clipping, raw HTML styling, or unusable controls should be present.
 */

const VIEWPORTS = [
  { name: "desktop", width: 1280, height: 900 },
  { name: "narrow", width: 375, height: 812 },
] as const;

const PAGES_TO_CAPTURE = [
  {
    name: "personal-workflows",
    path: "/personal/personal/workflows",
    label: "Personal Workflows",
  },
  {
    name: "org-workflows",
    path: `/acme/${MOCK_ORG_WORKSPACE.slug}/workflows`,
    label: "Org Workflows",
  },
  {
    name: "org-settings",
    path: `/${MOCK_ORG.slug}/settings`,
    label: "Org Settings",
  },
  {
    name: "environments",
    path: `/acme/${MOCK_ORG_WORKSPACE.slug}/settings/environments`,
    label: "Environments",
  },
  {
    name: "secrets",
    path: `/acme/${MOCK_ORG_WORKSPACE.slug}/settings/secrets`,
    label: "Secrets",
  },
  {
    name: "tokens",
    path: `/acme/${MOCK_ORG_WORKSPACE.slug}/settings/tokens`,
    label: "Tokens",
  },
  {
    name: "audit",
    path: "/audit",
    label: "Audit",
  },
] as const;

for (const viewport of VIEWPORTS) {
  test.describe(`Visual QA — ${viewport.name} (${viewport.width}px)`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    for (const pg of PAGES_TO_CAPTURE) {
      test(`${pg.label} at ${viewport.name}`, async ({ page }) => {
        await mockApiRoutes(page);
        await navigateAndWait(page, pg.path);

        // Verify page has content (not blank)
        await expect(page.locator("body")).not.toBeEmpty();

        // Verify header is visible (layout is rendering)
        const header = page.locator("header");
        await expect(header).toBeVisible();

        // Capture screenshot
        await page.screenshot({
          path: `.omo/evidence/task-30-visual-qa/${pg.name}-${viewport.name}.png`,
          fullPage: true,
        });
      });
    }
  });
}

// Additional: capture the 404 page at both viewports
for (const viewport of VIEWPORTS) {
  test.describe(`Visual QA — 404 at ${viewport.name}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test("404 page renders correctly", async ({ page }) => {
      await mockApiRoutes(page);
      await navigateAndWait(page, "/nonexistent/workspace/workflows");

      await expect(page.locator("body")).toContainText("Page not found");

      await page.screenshot({
        path: `.omo/evidence/task-30-visual-qa/not-found-${viewport.name}.png`,
        fullPage: true,
      });
    });
  });
}
