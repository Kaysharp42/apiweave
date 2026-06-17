import { test, expect } from '@playwright/test';
import {
  mockApiRoutes,
  navigateAndWait,
  captureEvidence,
  MOCK_ORG_WORKSPACE,
  MOCK_SECRET_METADATA,
} from './fixtures/auth';

/**
 * secret-write.spec.ts — Add secret, verify name visible, value NOT in DOM.
 *
 * Verifies:
 * 1. Secrets page loads with secret list
 * 2. Secret name is visible in the list
 * 3. Secret value is NOT present in the DOM (defense-in-depth)
 * 4. Add secret modal opens
 */

test.describe('Secret Write', () => {
  test('secrets page loads with header and list', async ({ page }) => {
    await mockApiRoutes(page);
    await navigateAndWait(
      page,
      `/acme/${MOCK_ORG_WORKSPACE.slug}/settings/secrets`,
    );

    // Should show the page title
    await expect(page.locator('body')).toContainText('Secrets');

    // Should show the scope path
    await expect(page.locator('body')).toContainText('acme');

    // Should show the secret name in the list
    await expect(page.locator('body')).toContainText(MOCK_SECRET_METADATA.name);

    await captureEvidence(page, 'task-30-secret-write-list.png');
  });

  test('secret value is NOT in the DOM', async ({ page }) => {
    await mockApiRoutes(page);
    await navigateAndWait(
      page,
      `/acme/${MOCK_ORG_WORKSPACE.slug}/settings/secrets`,
    );

    // The secret value should never appear in the page content
    const bodyText = await page.locator('body').textContent();
    expect(bodyText).not.toContain('super-secret-value');
    expect(bodyText).not.toContain('sk_live_');
    expect(bodyText).not.toContain('password123');

    // Verify the secret name IS visible (metadata only)
    await expect(page.locator('body')).toContainText(MOCK_SECRET_METADATA.name);

    await captureEvidence(page, 'task-30-secret-write-no-value.png');
  });

  test('add secret modal opens', async ({ page }) => {
    await mockApiRoutes(page);
    await navigateAndWait(
      page,
      `/acme/${MOCK_ORG_WORKSPACE.slug}/settings/secrets`,
    );

    // Click "Add secret" button
    const addBtn = page.getByRole('button', { name: /Add secret/i });
    await expect(addBtn).toBeVisible();
    await addBtn.click();

    // Modal should appear
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(/Add.*secret/i);

    await captureEvidence(page, 'task-30-secret-write-modal.png');
  });
});
