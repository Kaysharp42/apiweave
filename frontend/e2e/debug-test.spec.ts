import { test } from '@playwright/test';
import { mockApiRoutes } from './fixtures/auth';

test('debug page content', async ({ page }) => {
  await mockApiRoutes(page);
  await page.goto('/personal/personal/workflows');
  await page.waitForTimeout(3000);

  const html = await page.content();
  const bodyText = await page.locator('body').textContent();

  console.log('=== PAGE HTML (first 2000 chars) ===');
  console.log(html.substring(0, 2000));
  console.log('=== BODY TEXT ===');
  console.log(bodyText);
  console.log('=== URL ===');
  console.log(page.url());

  await page.screenshot({ path: '.omo/evidence/debug-page.png', fullPage: true });
});
