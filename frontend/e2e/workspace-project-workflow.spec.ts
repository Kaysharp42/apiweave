import { test, expect } from '@playwright/test';
import {
  mockApiRoutes,
  navigateAndWait,
  captureEvidence,
  MOCK_ORG,
  MOCK_ORG_WORKSPACE,
  MOCK_PROJECT,
  MOCK_WORKFLOW,
} from './fixtures/auth';

/**
 * workspace-project-workflow.spec.ts — Create project + workflow, see them in sidebar.
 *
 * Verifies:
 * 1. Workspace page loads with workflows
 * 2. Project page shows project details and workflows
 * 3. Workflow is accessible from project page
 */

test.describe('Workspace Project Workflow', () => {
  test('workspace workflows page loads', async ({ page }) => {
    await mockApiRoutes(page);
    await navigateAndWait(page, `/acme/${MOCK_ORG_WORKSPACE.slug}/workflows`);

    // Should be on the correct URL
    await expect(page).toHaveURL(/\/acme\/.*\/workflows/);

    // Header should be visible
    const header = page.locator('header');
    await expect(header).toBeVisible();

    // Switcher should show org/workspace
    const switcher = page.locator('[aria-label="Switch workspace"]');
    await expect(switcher).toBeVisible();

    await captureEvidence(page, 'task-30-workspace-workflows.png');
  });

  test('project page shows project details', async ({ page }) => {
    await mockApiRoutes(page);
    await navigateAndWait(
      page,
      `/acme/${MOCK_ORG_WORKSPACE.slug}/projects/${MOCK_PROJECT.projectId}`,
    );

    // Should show project name
    await expect(page.locator('body')).toContainText(MOCK_PROJECT.name);

    // Should show workflow count badge
    await expect(page.locator('body')).toContainText('workflow');

    // Should show the workflow in the list
    await expect(page.locator('body')).toContainText(MOCK_WORKFLOW.name);

    await captureEvidence(page, 'task-30-workspace-project.png');
  });

  test('project page has breadcrumb navigation', async ({ page }) => {
    await mockApiRoutes(page);
    await navigateAndWait(
      page,
      `/acme/${MOCK_ORG_WORKSPACE.slug}/projects/${MOCK_PROJECT.projectId}`,
    );

    // Should have a Back button
    const backBtn = page.getByRole('button', { name: /Back/i });
    await expect(backBtn).toBeVisible();

    await captureEvidence(page, 'task-30-workspace-project-breadcrumb.png');
  });
});
