import { defineConfig, devices } from "@playwright/test";

/**
 * Renderer E2E configuration. Tests inject the Electron IPC bridge before
 * navigation, then exercise the desktop HashRouter against the Vite renderer.
 *
 * Starts the Vite dev server automatically and runs E2E tests against it.
 * Screenshots and traces are written to `.omo/evidence/`.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [
    ["list"],
    [
      "html",
      { open: "never", outputFolder: ".omo/evidence/playwright-report" },
    ],
  ],
  timeout: 60_000,
  expect: { timeout: 10_000 },

  outputDir: ".omo/evidence/playwright-results",

  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "on-first-retry",
    screenshot: "on",
    video: "retain-on-failure",
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],

  webServer: {
    command: "npm run dev:renderer",
    url: "http://127.0.0.1:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
