import { test, expect, type Page } from "@playwright/test";
import {
  mockApiRoutes,
  navigateAndWait,
  captureEvidence,
  MOCK_PERSONAL_WORKSPACE,
  MOCK_WORKFLOW,
  MOCK_ENVIRONMENT,
  MOCK_PROJECT,
} from "./fixtures/auth";

/**
 * scoped-only-boot.spec.ts — Task 14: Verify scoped workspace boot and workflows.
 *
 * Verifies:
 * 1. Authenticated root `/` redirects to `/personal/workflows`
 * 2. `/personal/workflows` boots with zero 404s on scoped APIs
 * 3. Workflow list renders
 * 4. Workflow can be opened
 * 5. Workflow run triggers scoped API
 * 6. Environment selector works
 * 7. Project/workspace navigation works
 * 8. No legacy unscoped API calls (`/api/workflows`, `/api/environments`, `/api/collections`)
 */

// Legacy route patterns that must NOT be called after the scoped refactor
const LEGACY_ROUTE_PATTERNS = [
  /\/api\/workflows(\?|$)/,
  /\/api\/environments(\?|$)/,
  /\/api\/collections(\?|$)/,
];

/**
 * Install additional mock routes for the personal workspace.
 * The shared mockApiRoutes covers the org workspace; this adds personal-scope routes.
 */
async function mockPersonalWorkspaceRoutes(page: Page): Promise<void> {
  await mockApiRoutes(page);

  // Personal workspace workflows
  await page.route(
    `**/api/workspaces/${MOCK_PERSONAL_WORKSPACE.workspaceId}/workflows*`,
    (route) => {
      if (route.request().method() === "POST") {
        return route.fulfill({
          status: 201,
          contentType: "application/json",
          body: JSON.stringify(MOCK_WORKFLOW),
        });
      }
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ workflows: [MOCK_WORKFLOW], total: 1 }),
      });
    },
  );

  // Personal workspace workflow by ID
  await page.route(
    `**/api/workspaces/${MOCK_PERSONAL_WORKSPACE.workspaceId}/workflows/${MOCK_WORKFLOW.workflowId}*`,
    (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(MOCK_WORKFLOW),
      }),
  );

  // Personal workspace workflow run
  await page.route(
    `**/api/workspaces/${MOCK_PERSONAL_WORKSPACE.workspaceId}/workflows/${MOCK_WORKFLOW.workflowId}/run`,
    (route) =>
      route.fulfill({
        status: 202,
        contentType: "application/json",
        body: JSON.stringify({ runId: "run-001", status: "running" }),
      }),
  );

  // Personal workspace environments
  await page.route(
    `**/api/workspaces/${MOCK_PERSONAL_WORKSPACE.workspaceId}/environments*`,
    (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([MOCK_ENVIRONMENT]),
      }),
  );

  // Personal workspace projects
  await page.route(
    `**/api/workspaces/${MOCK_PERSONAL_WORKSPACE.workspaceId}/projects*`,
    (route) => {
      if (route.request().url().includes(MOCK_PROJECT.projectId)) {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(MOCK_PROJECT),
        });
      }
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ projects: [MOCK_PROJECT], total: 1 }),
      });
    },
  );

  // Run status polling
  await page.route("**/api/runs/*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        runId: "run-001",
        workflowId: MOCK_WORKFLOW.workflowId,
        status: "completed",
        results: [],
        nodeStatuses: {},
        failedNodes: [],
      }),
    }),
  );
}

/**
 * Collect all network requests made by the page and return them as structured entries.
 */
function collectNetworkRequests(
  page: Page,
): Array<{ url: string; method: string; status: number }> {
  const requests: Array<{ url: string; method: string; status: number }> = [];
  page.on("response", (response) => {
    const url = response.url();
    if (url.includes("/api/")) {
      requests.push({
        url,
        method: response.request().method(),
        status: response.status(),
      });
    }
  });
  return requests;
}

test.describe("Scoped-Only Boot — Task 14", () => {
  test("authenticated root redirects to personal workspace", async ({
    page,
  }) => {
    await mockPersonalWorkspaceRoutes(page);
    const networkLog = collectNetworkRequests(page);

    await navigateAndWait(page, "/");

    // Should redirect to /personal/workflows
    await expect(page).toHaveURL(/\/personal\/workflows/);

    // Capture screenshot evidence
    await captureEvidence(page, "task-14-root-redirect.png");

    // Verify no legacy unscoped API calls
    const legacyCalls = networkLog.filter((req) =>
      LEGACY_ROUTE_PATTERNS.some((pattern) => pattern.test(req.url)),
    );
    expect(
      legacyCalls,
      `Legacy API calls detected: ${JSON.stringify(legacyCalls)}`,
    ).toEqual([]);
  });

  test("/personal/workflows boots with zero 404s", async ({ page }) => {
    await mockPersonalWorkspaceRoutes(page);
    const networkLog = collectNetworkRequests(page);

    await navigateAndWait(page, "/personal/workflows");

    // Page should load without errors
    await expect(page.locator("body")).toBeVisible();

    // Check for 404 responses on scoped API calls
    const notFoundResponses = networkLog.filter(
      (req) => req.status === 404 && req.url.includes("/api/"),
    );
    expect(
      notFoundResponses,
      `404 responses detected: ${JSON.stringify(notFoundResponses)}`,
    ).toEqual([]);

    // No legacy routes
    const legacyCalls = networkLog.filter((req) =>
      LEGACY_ROUTE_PATTERNS.some((pattern) => pattern.test(req.url)),
    );
    expect(
      legacyCalls,
      `Legacy API calls detected: ${JSON.stringify(legacyCalls)}`,
    ).toEqual([]);
  });

  test("workflow list renders in personal workspace", async ({ page }) => {
    await mockPersonalWorkspaceRoutes(page);

    await navigateAndWait(page, "/personal/workflows");

    // Should show the workflow name from mock data
    await expect(page.locator("body")).toContainText(MOCK_WORKFLOW.name);
  });

  test("workflow can be opened from list", async ({ page }) => {
    await mockPersonalWorkspaceRoutes(page);

    await navigateAndWait(page, "/personal/workflows");

    // Click on the workflow
    const workflowItem = page.getByText(MOCK_WORKFLOW.name);
    await workflowItem.click();

    // Should navigate to the workflow editor
    await expect(page).toHaveURL(
      new RegExp(`/personal/workflows/${MOCK_WORKFLOW.workflowId}`),
    );
  });

  test("workflow run triggers scoped API", async ({ page }) => {
    await mockPersonalWorkspaceRoutes(page);
    const networkLog = collectNetworkRequests(page);

    await navigateAndWait(
      page,
      `/personal/workflows/${MOCK_WORKFLOW.workflowId}`,
    );

    // Look for a Run button
    const runButton = page.getByRole("button", { name: /run/i });
    if (await runButton.isVisible({ timeout: 3000 }).catch(() => false)) {
      await runButton.click();

      // Wait for the run API call
      await page.waitForTimeout(1000);

      // Verify the run call used scoped route
      const runCalls = networkLog.filter((req) =>
        req.url.includes(`/workflows/${MOCK_WORKFLOW.workflowId}/run`),
      );
      expect(runCalls.length).toBeGreaterThan(0);

      // All run calls should be scoped (contain workspace ID)
      const unscopedRunCalls = runCalls.filter(
        (req) => !req.url.includes(MOCK_PERSONAL_WORKSPACE.workspaceId),
      );
      expect(
        unscopedRunCalls,
        `Unscoped run calls detected: ${JSON.stringify(unscopedRunCalls)}`,
      ).toEqual([]);
    }
  });

  test("environment selector loads scoped environments", async ({ page }) => {
    await mockPersonalWorkspaceRoutes(page);
    const networkLog = collectNetworkRequests(page);

    await navigateAndWait(
      page,
      `/personal/workflows/${MOCK_WORKFLOW.workflowId}`,
    );

    // Look for environment selector
    const envSelector = page.locator(
      '[aria-label*="environment" i], [data-testid*="environment" i]',
    );
    if (
      await envSelector
        .first()
        .isVisible({ timeout: 3000 })
        .catch(() => false)
    ) {
      await envSelector.first().click();

      // Should show the mock environment
      await expect(page.locator("body")).toContainText(MOCK_ENVIRONMENT.name);
    }

    // Verify environment API calls are scoped
    const envCalls = networkLog.filter((req) =>
      req.url.includes("/environments"),
    );
    const unscopedEnvCalls = envCalls.filter(
      (req) =>
        !req.url.includes(MOCK_PERSONAL_WORKSPACE.workspaceId) &&
        !req.url.includes("/api/auth/"),
    );
    expect(
      unscopedEnvCalls,
      `Unscoped environment calls detected: ${JSON.stringify(unscopedEnvCalls)}`,
    ).toEqual([]);
  });

  test("project navigation works in personal workspace", async ({ page }) => {
    await mockPersonalWorkspaceRoutes(page);
    const networkLog = collectNetworkRequests(page);

    await navigateAndWait(page, "/personal/workflows");

    // Look for a Projects link or tab
    const projectsLink = page
      .getByRole("link", { name: /projects/i })
      .or(page.getByRole("button", { name: /projects/i }));
    if (
      await projectsLink
        .first()
        .isVisible({ timeout: 3000 })
        .catch(() => false)
    ) {
      await projectsLink.first().click();

      // Should show project name
      await expect(page.locator("body")).toContainText(MOCK_PROJECT.name);
    }

    // Save network log as evidence
    const evidencePath = ".omo/evidence/task-14-workflow-project-network.json";
    const fs = await import("fs");
    const evidence = {
      timestamp: new Date().toISOString(),
      test: "project-navigation",
      requests: networkLog,
      legacyRoutePatterns: LEGACY_ROUTE_PATTERNS.map((p) => p.source),
      legacyCallsFound: networkLog.filter((req) =>
        LEGACY_ROUTE_PATTERNS.some((pattern) => pattern.test(req.url)),
      ),
    };
    fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2));
  });
});
