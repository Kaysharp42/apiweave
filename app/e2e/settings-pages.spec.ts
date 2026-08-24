import { expect, test } from "@playwright/test";
import {
  captureEvidence,
  installDesktopIpc,
  navigateDesktop,
} from "./fixtures/desktop";

/**
 * Every Settings row opens a page, not a dialog.
 *
 * The app-scoped rows used to open modals over whatever page was already
 * showing — clicking Private networks while on Secrets left the Secrets page
 * dimmed underneath. Nothing in Settings renders a dialog now, which is what
 * the `role=dialog` assertion is here to keep true.
 */

/**
 * Rows are addressed by their description, not their title: the nav rail has
 * its own "Agents" and "MCP" buttons, and a title-only match hits those first.
 */
const ROWS = [
  ["Launch a coding agent", "Agents"],
  ["Allow requests to LAN devices", "Private networks"],
  ["Let agents drive your workflows", "MCP Server"],
  ["Check for and install new versions", "Updates"],
] as const;

test.beforeEach(async ({ page }) => {
  await installDesktopIpc(page);
});

for (const [description, heading] of ROWS) {
  test(`Settings > ${heading} opens a page`, async ({ page }) => {
    await navigateDesktop(page, "/personal/personal/settings/environments");

    await page.getByRole("button", { name: new RegExp(description) }).click();

    await expect(
      page.getByRole("heading", { name: heading, level: 1 }),
    ).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await captureEvidence(
      page,
      `settings-${heading.toLowerCase().replace(/ /g, "-")}.png`,
    );
  });
}
