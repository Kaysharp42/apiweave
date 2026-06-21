import { test, expect, type Page } from "@playwright/test";

/**
 * Redesign smoke tests — verify public/auth routes render at multiple viewport
 * widths and capture evidence screenshots for visual regression tracking.
 *
 * These tests do NOT require backend data or authentication.
 * Protected workspace QA may be added later using the running dev stack + seeded flows.
 */

// ---------------------------------------------------------------------------
// Viewport presets matching the redesign breakpoint matrix
// ---------------------------------------------------------------------------
const VIEWPORTS = [
  { name: "375", width: 375, height: 812 }, // iPhone SE / small mobile
  { name: "768", width: 768, height: 1024 }, // iPad / tablet
  { name: "1024", width: 1024, height: 768 }, // small laptop
  { name: "1440", width: 1440, height: 900 }, // desktop
] as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Capture an evidence screenshot with the naming convention:
 *  `.omo/evidence/task-{N}-{slug}-{viewport}-{theme}.png`
 */
async function captureEvidence(
  page: Page,
  taskN: number,
  slug: string,
  viewport: string,
  theme: string,
) {
  const filename = `task-${taskN}-${slug}-${viewport}-${theme}.png`;
  await page.screenshot({
    path: `.omo/evidence/${filename}`,
    fullPage: true,
  });
}

/** Toggle the theme via AppContext if a theme toggle button is visible.
 *  Returns 'dark' if dark mode was activated, 'light' otherwise.
 */
async function tryToggleTheme(page: Page): Promise<"dark" | "light"> {
  // The app uses AppContext.setDarkMode. Look for common theme toggle selectors.
  // DaisyUI + Tailwind dark mode toggles are typically buttons with aria-labels
  // or icons like sun/moon.
  const themeToggle = page.locator(
    '[aria-label*="theme"], [aria-label*="dark"], [aria-label*="Theme"], ' +
      "button:has(svg.lucide-sun), button:has(svg.lucide-moon), " +
      "button:has(.lucide-sun), button:has(.lucide-moon)",
  );

  if (await themeToggle.isVisible({ timeout: 2000 }).catch(() => false)) {
    await themeToggle.first().click();
    // Wait for the DOM to update the dark class
    await page.waitForTimeout(300);
    const isDark = await page.evaluate(() =>
      document.documentElement.classList.contains("dark"),
    );
    return isDark ? "dark" : "light";
  }

  // No visible toggle found — check current state
  const isDark = await page.evaluate(() =>
    document.documentElement.classList.contains("dark"),
  );
  return isDark ? "dark" : "light";
}

// ---------------------------------------------------------------------------
// /login route tests
// ---------------------------------------------------------------------------

for (const vp of VIEWPORTS) {
  test.describe(`/login at ${vp.name}px width`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test("renders login page and captures light-theme screenshot", async ({
      page,
    }) => {
      await page.goto("/login");
      // Wait for the page to be hydrated
      await page.waitForLoadState("networkidle");

      // Verify we're on the login route
      await expect(page).toHaveURL(/\/login/);

      // Ensure the page has meaningful content (not blank)
      const body = page.locator("body");
      await expect(body).not.toBeEmpty();

      // Capture light theme screenshot
      await captureEvidence(page, 2, "login", vp.name, "light");
    });

    test("toggles theme and captures dark-theme screenshot", async ({
      page,
    }) => {
      await page.goto("/login");
      await page.waitForLoadState("networkidle");

      // Try to toggle to dark mode
      const theme = await tryToggleTheme(page);

      // Capture screenshot with whatever theme we ended up with
      await captureEvidence(page, 2, "login", vp.name, theme);
    });
  });
}

// ---------------------------------------------------------------------------
// /setup route tests
// ---------------------------------------------------------------------------

for (const vp of VIEWPORTS) {
  test.describe(`/setup at ${vp.name}px width`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test("renders setup page and captures light-theme screenshot", async ({
      page,
    }) => {
      await page.goto("/setup");
      await page.waitForLoadState("networkidle");

      // Verify we're on the setup route
      await expect(page).toHaveURL(/\/setup/);

      // Ensure the page has meaningful content
      const body = page.locator("body");
      await expect(body).not.toBeEmpty();

      // Capture light theme screenshot
      await captureEvidence(page, 2, "setup", vp.name, "light");
    });

    test("toggles theme and captures dark-theme screenshot", async ({
      page,
    }) => {
      await page.goto("/setup");
      await page.waitForLoadState("networkidle");

      // Try to toggle theme
      const theme = await tryToggleTheme(page);

      // Capture screenshot
      await captureEvidence(page, 2, "setup", vp.name, theme);
    });
  });
}
