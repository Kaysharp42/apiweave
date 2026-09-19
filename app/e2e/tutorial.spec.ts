import { expect, test, type Page } from "@playwright/test";
import {
  DESKTOP_WORKFLOW,
  captureEvidence,
  installDesktopIpc,
  navigateDesktop,
} from "./fixtures/desktop";

/**
 * The tutorial library, reader and follow-along companion on the desktop
 * renderer. Lesson content changes independently of behaviour, so these tests
 * address landmarks by role and assert product copy that belongs to the
 * tutorial chrome, not to a specific lesson's text.
 */

const WORKSPACE_PATH = "/personal/personal/workflows";
const LIBRARY_PATH = "/personal/personal/tutorials";
const LESSON_PATH = "/personal/personal/tutorials/first-workflow";

test.beforeEach(async ({ page }) => {
  await installDesktopIpc(page);
});

/**
 * The route alone does not mount the canvas — the workflow has to be opened
 * from the sidebar list, which seeds WorkflowContext with an active tab.
 */
async function openWorkflowTab(page: Page): Promise<void> {
  await navigateDesktop(page, WORKSPACE_PATH);
  const entry = page.getByRole("button", {
    name: new RegExp(DESKTOP_WORKFLOW.name),
  }).first();
  await entry.waitFor({ state: "visible", timeout: 30_000 });
  await entry.click();
  await page.waitForSelector(".react-flow__node", { timeout: 30_000 });
}

test.describe("tutorial library", () => {
  test("shows the progress summary and filters lessons with search", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await navigateDesktop(page, LIBRARY_PATH);

    await expect(
      page.getByRole("heading", { level: 1, name: "Tutorials" }),
    ).toBeVisible();
    await expect(
      page.getByText("Learn the workflow, one feature at a time."),
    ).toBeVisible();
    await expect(page.getByText(/\d+ of \d+ completed/)).toBeVisible();

    const search = page.getByLabel("Search lessons");
    await search.fill("sse");
    await expect(
      page.getByRole("button", { name: /Listen to an SSE stream/ }),
    ).toBeVisible();
    await expect(page.getByText(/lessons? match/)).toBeVisible();

    await search.fill("zzzznotalesson");
    await expect(page.getByText("No lessons match")).toBeVisible();
    await page.getByRole("button", { name: "Clear search" }).first().click();
    await expect(search).toHaveValue("");

    await captureEvidence(page, "tutorial-library-wide.png");
  });

  test("renders the article when a lesson is opened by URL", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await navigateDesktop(page, LESSON_PATH);

    await expect(
      page.getByRole("heading", {
        level: 1,
        name: "Build and run your first workflow",
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Outcome", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Steps", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Mark complete" }),
    ).toBeVisible();

    await captureEvidence(page, "tutorial-lesson-wide.png");
  });

  test("keeps a completed lesson across a reload", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await navigateDesktop(page, LESSON_PATH);

    await page.getByRole("button", { name: "Mark complete" }).click();
    await expect(
      page.getByRole("button", { name: "Mark not complete" }),
    ).toBeVisible();
    await expect(page.getByText(/1 of \d+ completed/)).toBeVisible();

    await page.reload();

    await expect(
      page.getByRole("button", { name: "Mark not complete" }),
    ).toBeVisible();
    await expect(page.getByText(/1 of \d+ completed/)).toBeVisible();
  });

  test("opens the library from the Help command in the command palette", async ({
    page,
  }) => {
    await openWorkflowTab(page);

    await page.getByRole("button", { name: "Open command palette" }).click();
    await page.getByRole("combobox", { name: "Search commands" }).fill("tour");
    await page.getByText("Open tutorials").click();

    await expect(page).toHaveURL(new RegExp(`${LIBRARY_PATH}$`));
    await expect(
      page.getByRole("heading", { level: 1, name: "Tutorials" }),
    ).toBeVisible();
  });
});

test.describe("tutorial follow-along", () => {
  test("opens the companion at step 1, advances, and keeps the step on resume", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openWorkflowTab(page);

    await page.getByRole("button", { name: "Tutorials" }).click();
    await expect(page).toHaveURL(new RegExp(`${LIBRARY_PATH}$`));
    await page
      .getByRole("button", { name: /Build and run your first workflow/ })
      .click();
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: "Build and run your first workflow",
      }),
    ).toBeVisible();

    await page.getByRole("button", { name: "Follow along" }).click();

    const companion = page.getByRole("complementary", {
      name: "Follow along",
    });
    await expect(companion).toBeVisible();
    await expect(companion.getByText("Step 1 of 9", { exact: true })).toBeVisible();
    await expect(
      companion.getByText("Create a new workflow", { exact: true }),
    ).toBeVisible();

    await companion.getByRole("button", { name: "Next" }).click();
    await expect(companion.getByText("Step 2 of 9", { exact: true })).toBeVisible();

    await companion
      .getByRole("button", { name: "Collapse follow-along" })
      .click();
    await page.getByRole("button", { name: "Resume" }).click();
    await expect(
      page
        .getByRole("complementary", { name: "Follow along" })
        .getByText("Step 2 of 9", { exact: true }),
    ).toBeVisible();

    await captureEvidence(page, "tutorial-companion-wide.png");
  });

  test("returning to the workspace uncovers the mounted canvas", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openWorkflowTab(page);

    await page.getByRole("button", { name: "Tutorials" }).click();
    await expect(page).toHaveURL(new RegExp(`${LIBRARY_PATH}$`));

    await page.getByRole("button", { name: "Back to workspace" }).click();
    await expect(page).toHaveURL(new RegExp(`${WORKSPACE_PATH}$`));

    const canvas = page.getByRole("main", { name: "Workflow canvas" });
    await expect(canvas).toBeVisible();
    await expect(canvas.locator(".react-flow__node")).toHaveCount(2);

    // The nav rail is the other documented exit: entering the tutorial again
    // and clicking Workflows must reveal the same canvas, not a fresh one.
    await page.getByRole("button", { name: "Tutorials" }).click();
    await expect(page).toHaveURL(new RegExp(`${LIBRARY_PATH}$`));

    await page.getByRole("button", { name: "Workflows", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${WORKSPACE_PATH}$`));
    await expect(canvas).toBeVisible();
    await expect(canvas.locator(".react-flow__node")).toHaveCount(2);
  });
});

test.describe("tutorial compact and dark presentations", () => {
  test("keeps the library usable at 768px and 375px", async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 900 });
    await navigateDesktop(page, LIBRARY_PATH);

    await expect(
      page.getByRole("heading", { level: 1, name: "Tutorials" }),
    ).toBeVisible();
    await expect(page.getByLabel("Search lessons")).toBeVisible();
    await captureEvidence(page, "tutorial-library-768.png");

    await page.setViewportSize({ width: 375, height: 812 });
    await expect(
      page.getByRole("heading", { level: 1, name: "Tutorials" }),
    ).toBeVisible();
    await captureEvidence(page, "tutorial-library-375.png");
  });

  test("collapses the companion to a strip on a compact window", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 768, height: 900 });
    await openWorkflowTab(page);
    await page.getByRole("button", { name: "Tutorials" }).click();

    await page
      .getByRole("button", { name: /Build and run your first workflow/ })
      .click();
    await page.getByRole("button", { name: "Follow along" }).click();

    // The compact presentation starts as a strip, not a panel over the canvas.
    await page.getByRole("button", { name: "Resume" }).click();
    await expect(
      page.getByRole("button", { name: "Back to workspace" }),
    ).toBeVisible();
    await expect(
      page.getByText("Step 1 of 9", { exact: true }),
    ).toBeVisible();
    await captureEvidence(page, "tutorial-companion-compact.png");

    await page.getByRole("button", { name: "Back to workspace" }).click();
    await expect(page.getByRole("button", { name: "Resume" })).toBeVisible();
  });

  test("renders the dark presentation", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await navigateDesktop(page, LIBRARY_PATH);
    await page.getByRole("button", { name: "Switch to dark mode" }).click();
    await expect(
      page.getByRole("button", { name: "Switch to light mode" }),
    ).toBeVisible();
    await captureEvidence(page, "tutorial-library-dark.png");

    await navigateDesktop(page, LESSON_PATH);
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: "Build and run your first workflow",
      }),
    ).toBeVisible();
    await captureEvidence(page, "tutorial-lesson-dark.png");
  });
});
