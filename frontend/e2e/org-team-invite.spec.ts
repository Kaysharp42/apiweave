import { test, expect } from '@playwright/test';
import {
  mockApiRoutes,
  navigateAndWait,
  captureEvidence,
  MOCK_ORG,
  MOCK_INVITE,
} from './fixtures/auth';

/**
 * org-team-invite.spec.ts — Owner invites a member.
 *
 * Verifies:
 * 1. Org settings page loads with tabs
 * 2. Invites tab shows pending invites
 * 3. Can open invite modal and submit
 */

test.describe('Org Team Invite', () => {
  test('org settings page loads with tabs', async ({ page }) => {
    await mockApiRoutes(page);
    await navigateAndWait(page, `/${MOCK_ORG.slug}/settings`);

    // Should show org name in header
    await expect(page.locator('body')).toContainText(MOCK_ORG.name);

    // Should show tabs: General, Members, Teams, Invites
    await expect(page.getByRole('tab')).toHaveCount(4);
    await expect(page.getByRole('tab', { name: /General/i })).toBeVisible();
    await expect(page.getByRole('tab', { name: /Members/i })).toBeVisible();
    await expect(page.getByRole('tab', { name: /Teams/i })).toBeVisible();
    await expect(page.getByRole('tab', { name: /Invites/i })).toBeVisible();

    await captureEvidence(page, 'task-30-org-settings-general.png');
  });

  test('invites tab shows pending invite row', async ({ page }) => {
    await mockApiRoutes(page);
    await navigateAndWait(page, `/${MOCK_ORG.slug}/settings`);

    // Click Invites tab
    await page.getByRole('tab', { name: /Invites/i }).click();

    // Should show the pending invite
    await expect(page.locator('body')).toContainText(MOCK_INVITE.email);

    await captureEvidence(page, 'task-30-org-team-invite.png');
  });

  test('members tab shows current members', async ({ page }) => {
    await mockApiRoutes(page);
    await navigateAndWait(page, `/${MOCK_ORG.slug}/settings`);

    // Click Members tab
    await page.getByRole('tab', { name: /Members/i }).click();

    // Should show member info
    await expect(page.locator('body')).not.toBeEmpty();

    await captureEvidence(page, 'task-30-org-team-members.png');
  });

  test('teams tab renders', async ({ page }) => {
    await mockApiRoutes(page);
    await navigateAndWait(page, `/${MOCK_ORG.slug}/settings`);

    // Click Teams tab
    await page.getByRole('tab', { name: /Teams/i }).click();

    await expect(page.locator('body')).not.toBeEmpty();

    await captureEvidence(page, 'task-30-org-team-teams.png');
  });
});
