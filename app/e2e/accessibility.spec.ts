import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import type { AxeResults } from "axe-core";
import {
  DESKTOP_WORKFLOW,
  DESKTOP_WORKSPACE,
  installDesktopIpc,
  navigateDesktop,
  sidebarWorkflowButton,
} from "./fixtures/desktop";

/**
 * The WCAG 2.1 AA gate.
 *
 * PRODUCT.md claims the product is WCAG 2.1 AA, so this is a real gate rather
 * than a smoke test: every scan runs the full WCAG 2.1 A/AA rule set and fails
 * on serious or critical findings, which are the ones that block a screen
 * reader or keyboard user rather than merely annoy them.
 *
 * Scans cover the three surfaces every session touches — the canvas shell, the
 * settings screens and a modal — because an automated axe pass is only as good
 * as the states it is pointed at. `qa:ui` runs this file with the rest of the
 * Playwright suite.
 */

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

const WORKFLOW_ID = "wf-accessibility";
const WORKFLOW = {
  ...DESKTOP_WORKFLOW,
  workflowId: WORKFLOW_ID,
  name: "Accessibility workflow",
  nodes: [
    {
      nodeId: "request-1",
      type: "http-request",
      label: "Get users",
      position: { x: 240, y: 180 },
      config: {
        method: "GET",
        url: "https://api.example.com/users",
        queryParams: [],
        headers: [],
        cookies: [],
        bodyType: "json",
        body: "{}",
        timeout: 30,
        followRedirects: true,
        sslVerify: true,
        continueOnFail: false,
      },
    },
  ],
  edges: [],
} as const;

function describeViolations(results: AxeResults): string {
  return results.violations
    .map((violation) => {
      const nodes = violation.nodes
        .map((node) => `  ${node.target.join(" ")} — ${node.failureSummary}`)
        .join("\n");
      return `${violation.id} (${violation.impact}): ${violation.help}\n${nodes}`;
    })
    .join("\n\n");
}

async function scan(
  page: Page,
  context: string,
  include?: string,
): Promise<void> {
  let builder = new AxeBuilder({ page }).withTags(WCAG_TAGS);
  if (include !== undefined) builder = builder.include(include);
  const results = await builder.analyze();
  const blocking = results.violations.filter(
    (violation) =>
      violation.impact === "serious" || violation.impact === "critical",
  );
  expect(
    blocking,
    `${context} has serious or critical WCAG 2.1 AA violations:\n${describeViolations(results)}`,
  ).toEqual([]);
}

async function openWorkflow(page: Page): Promise<void> {
  await installDesktopIpc(page, { workflow: WORKFLOW });
  await navigateDesktop(page, `/${DESKTOP_WORKSPACE.slug}/workflows/${WORKFLOW_ID}`);

  const workflowButton = sidebarWorkflowButton(page, WORKFLOW.name);
  if (!(await workflowButton.isVisible())) {
    await page.getByRole("button", { name: "Toggle sidebar" }).click();
  }
  await workflowButton.click();
  // The canvas is a lazy route; a loaded dev server can take a moment to
  // transform its chunk, so give the first paint room under parallel runs.
  await expect(
    page.getByRole("main", { name: "Workflow canvas" }),
  ).toBeVisible({ timeout: 20_000 });
  await expect(
    page.locator(".react-flow__node").filter({ hasText: "Get users" }),
  ).toBeAttached({ timeout: 20_000 });
}

const SETTINGS_HEADINGS: Readonly<Record<string, string>> = {
  environments: "Environments",
  secrets: "Secrets",
  "version-history": "Version history (git)",
  agents: "Agents",
  "mcp-server": "MCP Server",
  updates: "Updates",
};

async function openSettings(page: Page, section: string): Promise<void> {
  await installDesktopIpc(page, { workflow: WORKFLOW });
  await navigateDesktop(page, `/personal/personal/settings/${section}`);
  const heading = SETTINGS_HEADINGS[section];
  if (heading === undefined) throw new Error(`Unknown settings section: ${section}`);
  await expect(
    page.getByRole("heading", { level: 1, name: heading }),
  ).toBeVisible({ timeout: 20_000 });
}

test.describe("WCAG 2.1 AA", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("canvas shell", async ({ page }) => {
    await openWorkflow(page);
    await scan(page, "canvas shell");
  });

  for (const section of ["environments", "secrets", "version-history"]) {
    test(`workspace settings: ${section}`, async ({ page }) => {
      await openSettings(page, section);
      await scan(page, `workspace settings ${section}`);
    });
  }

  for (const section of ["agents", "mcp-server", "updates"]) {
    test(`app settings: ${section}`, async ({ page }) => {
      await openSettings(page, section);
      await scan(page, `app settings ${section}`);
    });
  }

  test("node editor dialog", async ({ page }) => {
    await openWorkflow(page);

    const nodeLabel = page
      .locator(".react-flow__node")
      .filter({ hasText: "Get users" })
      .first()
      .getByText("Get users", { exact: true });
    try {
      await nodeLabel.dblclick({ timeout: 5_000 });
    } catch {
      await nodeLabel.dispatchEvent("dblclick");
    }

    const dialog = page.getByRole("dialog");
    // The dialog's outer element is a zero-box positioning root; its panels are
    // fixed. Wait on something that actually paints rather than on the root.
    await expect(dialog.getByRole("tab", { name: "Params" })).toBeVisible();
    await scan(page, "node editor dialog", '[role="dialog"]');
  });
});
