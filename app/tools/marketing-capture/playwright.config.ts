import { defineConfig, devices } from "@playwright/test";

/**
 * Marketing capture runner.
 *
 * Deliberately not the `app/playwright.config.ts` E2E project: captures are
 * serial (one at a time, no retries, no parallel workers) because two of them
 * writing frames while a third drives a timed run makes the timing of the
 * master demo a function of machine load. `deviceScaleFactor: 2` is the whole
 * sharpness strategy — every crop is authored in CSS pixels at half its
 * destination size and lands at 1:1.
 */
export default defineConfig({
  testDir: ".",
  testMatch: /.*\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: true,
  timeout: 180_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  outputDir: "output/playwright",
  use: {
    ...devices["Desktop Chrome"],
    baseURL: "http://127.0.0.1:3000",
    deviceScaleFactor: 2,
    viewport: { width: 1600, height: 1000 },
    trace: "off",
    screenshot: "off",
    video: "off",
    actionTimeout: 20_000,
    navigationTimeout: 60_000,
    ...(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {}),
  },
  webServer: {
    command: "npm run dev:renderer",
    cwd: "../..",
    url: "http://127.0.0.1:3000",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
