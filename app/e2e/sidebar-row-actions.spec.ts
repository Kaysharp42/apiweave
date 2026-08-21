import { expect, test, type Page } from "@playwright/test";
import { navigateDesktop } from "./fixtures/desktop";

/**
 * Right-click actions on the sidebar's project and workflow rows.
 *
 * The shared `installDesktopIpc` fixture serves one workspace and no projects,
 * which is exactly the shape these menus have nothing to offer for: a move needs
 * a second workspace to move into and a project to move between. So this spec
 * installs its own bridge, and records every call so a move can be asserted on
 * the request that left the renderer rather than on a toast.
 */

const PERSONAL = {
  workspaceId: "workspace-personal",
  slug: "personal",
  name: "Personal",
  description: null,
  isPersonal: true,
  origin: "local",
  syncMode: "none",
  rev: 0,
  createdAt: "2026-07-20T00:00:00.000Z",
  updatedAt: "2026-07-20T00:00:00.000Z",
} as const;

const TEAM = {
  ...PERSONAL,
  workspaceId: "workspace-team",
  slug: "team",
  name: "Team space",
  isPersonal: false,
} as const;

const PROJECT = {
  collectionId: "project-checkout",
  projectId: "project-checkout",
  workspaceId: PERSONAL.workspaceId,
  name: "Checkout",
  description: null,
  color: null,
  workflowCount: 1,
  workflowOrder: [],
  continueOnFail: false,
  rev: 0,
  createdAt: "2026-07-20T00:00:00.000Z",
  updatedAt: "2026-07-20T00:00:00.000Z",
} as const;

const ATTACHED_WORKFLOW = {
  workflowId: "workflow-attached",
  workspaceId: PERSONAL.workspaceId,
  name: "Place order",
  description: "In the Checkout project",
  nodes: [
    { nodeId: "start-1", type: "start", label: "Start", position: { x: 0, y: 0 }, config: {} },
    {
      nodeId: "call-1",
      type: "workflow",
      label: "Call login",
      position: { x: 200, y: 0 },
      config: { targetWorkflowId: "workflow-loose", targetWorkflowName: "Log in" },
    },
  ],
  edges: [],
  variables: {},
  tags: [],
  collectionId: PROJECT.collectionId,
  selectedEnvironmentId: "env-staging",
  nodeTemplates: [],
  rev: 0,
  createdAt: "2026-07-20T00:00:00.000Z",
  updatedAt: "2026-07-20T00:00:00.000Z",
} as const;

const LOOSE_WORKFLOW = {
  ...ATTACHED_WORKFLOW,
  workflowId: "workflow-loose",
  name: "Log in",
  description: "In no project",
  nodes: [ATTACHED_WORKFLOW.nodes[0]],
  collectionId: null,
  selectedEnvironmentId: null,
} as const;

const STAGING_ENV = {
  environmentId: "env-staging",
  workspaceId: PERSONAL.workspaceId,
  name: "Staging",
  description: null,
  scopeType: "workspace",
  scopeId: PERSONAL.workspaceId,
  variables: {},
  swaggerDocUrl: null,
  rev: 0,
  createdAt: "2026-07-20T00:00:00.000Z",
  updatedAt: "2026-07-20T00:00:00.000Z",
} as const;

/** Every `domain.action` the renderer invoked, with its payload. */
interface RecordedCall {
  readonly domain: string;
  readonly action: string;
  readonly payload: unknown;
}

declare global {
  interface Window {
    __E2E_CALLS__?: RecordedCall[];
  }
}

async function installBridge(page: Page): Promise<void> {
  await page.addInitScript(
    (seed) => {
      window.__E2E_CALLS__ = [];
      const list = { items: [] as unknown[], total: 0 };
      // One entry per `domain.action` the sidebar reaches for, so adding a call
      // is one line rather than another branch.
      const answers: Record<string, (payload: unknown) => unknown> = {
        "workspaces.list": () => [seed.personal, seed.team],
        "workflows.list": () => ({
          items: [seed.loose, seed.attached],
          total: 2,
        }),
        "workflows.get": () => seed.loose,
        "workflows.update": (payload) => ({
          ...seed.loose,
          name: (payload as { name?: string }).name ?? seed.loose.name,
        }),
        "workflows.moveToWorkspace": () => seed.loose,
        "workflows.attachToCollection": () => seed.loose,
        "projects.list": (payload) =>
          (payload as { workspaceId?: string }).workspaceId ===
          seed.personal.workspaceId
            ? { items: [seed.project], total: 1 }
            : list,
        "projects.update": (payload) => ({
          ...seed.project,
          name: (payload as { name?: string }).name ?? seed.project.name,
        }),
        "projects.moveToWorkspace": () => seed.project,
        "environments.list": () => ({ items: [seed.env], total: 1 }),
        "secrets.list": () => [],
        "cloud.status": () => ({
          linked: false,
          active: false,
          linkState: "unlinked",
          syncState: "idle",
          state: "idle",
          pendingCount: 0,
          deadLetterCount: 0,
          conflictCount: 0,
          workspaceIds: [],
          bindings: [],
          workspaceCatalog: [],
          teamCatalog: [],
        }),
      };
      // Run history is polled under several suffixes (`listRecent`,
      // `getLatestForWorkflow`, …), so these match on the prefix.
      const prefixed: ReadonlyArray<readonly [string, () => unknown]> = [
        ["runs.list", () => list],
        ["runs.getLatest", () => null],
      ];
      window.__APIWEAVE_IPC__ = {
        invoke: async (domain, action, payload) => {
          window.__E2E_CALLS__?.push({ domain, action, payload });
          const key = `${domain}.${action}`;
          const answer =
            answers[key] ??
            prefixed.find(([candidate]) => key.startsWith(candidate))?.[1];
          if (answer) {
            return { ok: true as const, data: answer(payload) };
          }
          return {
            ok: false as const,
            error: {
              code: "not_found" as const,
              message: `Unhandled E2E IPC call: ${key}`,
            },
          };
        },
        onRunProgress: () => () => undefined,
        onCloudStatusChanged: () => () => undefined,
      };
    },
    {
      personal: PERSONAL,
      team: TEAM,
      project: PROJECT,
      attached: ATTACHED_WORKFLOW,
      loose: LOOSE_WORKFLOW,
      env: STAGING_ENV,
    },
  );
}

function callsOf(page: Page, domain: string, action: string) {
  return page.evaluate(
    ({ domain: d, action: a }) =>
      (window.__E2E_CALLS__ ?? []).filter(
        (call) => call.domain === d && call.action === a,
      ),
    { domain, action },
  );
}

/**
 * The projects list is a nav-section switch, not a route — `MainLayout` refetches
 * projects when the section changes, so clicking the rail is the only way in.
 */
async function openProjectsSection(page: Page): Promise<void> {
  await navigateDesktop(page, "/personal/workflows");
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("button", { name: "Projects", exact: true })
    .click();
}

test.describe("sidebar row right-click actions", () => {
  test.beforeEach(async ({ page }) => {
    await installBridge(page);
  });

  test("a workflow row offers rename and both moves", async ({ page }) => {
    await navigateDesktop(page, "/personal/workflows");

    const row = page.getByRole("button", { name: /Log in/ });
    await expect(row).toBeVisible();
    await row.click({ button: "right" });

    const menu = page.getByRole("menu", { name: 'Workflow "Log in"' });
    await expect(menu).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: "Rename…" })).toBeVisible();
    await expect(
      menu.getByRole("menuitem", { name: "Move to project…" }),
    ).toBeVisible();
    await expect(
      menu.getByRole("menuitem", { name: "Move to workspace…" }),
    ).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: "Delete" })).toBeVisible();

    // Escape must dismiss it — a context menu with no keyboard exit traps focus.
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
  });

  test("renaming a workflow opens on its current name and sends the new one", async ({
    page,
  }) => {
    await navigateDesktop(page, "/personal/workflows");

    await page.getByRole("button", { name: /Log in/ }).click({ button: "right" });
    await page.getByRole("menuitem", { name: "Rename…" }).click();

    const input = page.getByRole("textbox", { name: "Rename Workflow" });
    await expect(input).toHaveValue("Log in");

    await input.fill("Sign in");
    await page.getByRole("button", { name: "Rename" }).click();

    await expect
      .poll(async () => await callsOf(page, "workflows", "update"))
      .toContainEqual(
        expect.objectContaining({
          payload: expect.objectContaining({
            workflowId: LOOSE_WORKFLOW.workflowId,
            name: "Sign in",
          }),
        }),
      );
  });

  test("moving a workflow to a project lists the workspace's projects", async ({
    page,
  }) => {
    await navigateDesktop(page, "/personal/workflows");

    await page.getByRole("button", { name: /Log in/ }).click({ button: "right" });
    await page.getByRole("menuitem", { name: "Move to project…" }).click();

    const select = page.getByRole("combobox", { name: "Target project" });
    await expect(select).toBeVisible();
    await expect(select.getByRole("option")).toHaveText([
      "No project",
      "Checkout",
    ]);

    await select.selectOption(PROJECT.collectionId);
    await page.getByRole("button", { name: "Move" }).click();

    await expect
      .poll(async () => await callsOf(page, "workflows", "attachToCollection"))
      .toContainEqual(
        expect.objectContaining({
          payload: expect.objectContaining({
            workflowId: LOOSE_WORKFLOW.workflowId,
            collectionId: PROJECT.collectionId,
          }),
        }),
      );
  });

  test("moving a workflow to another workspace spells out what it drops", async ({
    page,
  }) => {
    await navigateDesktop(page, "/personal/workflows");

    // The attached workflow is the interesting one: it has a project, a selected
    // environment and a Call Workflow target, so all three warnings are due.
    await page
      .getByRole("button", { name: /Place order/ })
      .click({ button: "right" });
    await page.getByRole("menuitem", { name: "Move to workspace…" }).click();

    const destination = page.getByRole("combobox", {
      name: "Destination workspace",
      exact: true,
    });
    // Only the OTHER workspace is offered — moving somewhere it already is would
    // be rejected by the service as a validation error.
    await expect(destination.getByRole("option")).toHaveText(["Team space"]);

    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("Staging");
    await expect(dialog).toContainText("Call Workflow node");
    await expect(dialog).toContainText("leaves");

    await page.getByRole("button", { name: "Move" }).click();

    await expect
      .poll(async () => await callsOf(page, "workflows", "moveToWorkspace"))
      .toContainEqual(
        expect.objectContaining({
          payload: expect.objectContaining({
            workflowId: ATTACHED_WORKFLOW.workflowId,
            targetWorkspaceId: TEAM.workspaceId,
            targetCollectionId: null,
          }),
        }),
      );
  });

  test("a project row offers rename and a workspace move", async ({ page }) => {
    await openProjectsSection(page);

    const row = page.getByRole("button", { name: /Checkout/ });
    await expect(row).toBeVisible();
    await row.click({ button: "right" });

    const menu = page.getByRole("menu", { name: 'Project "Checkout"' });
    await expect(menu.getByRole("menuitem", { name: "Rename…" })).toBeVisible();
    await expect(
      menu.getByRole("menuitem", { name: "Move to workspace…" }),
    ).toBeVisible();
    // A project has no "move to project" — the hierarchy is only two deep.
    await expect(
      menu.getByRole("menuitem", { name: "Move to project…" }),
    ).toHaveCount(0);

    await menu.getByRole("menuitem", { name: "Rename…" }).click();
    const input = page.getByRole("textbox", { name: "Rename Project" });
    await expect(input).toHaveValue("Checkout");

    await input.fill("Cart");
    await page.getByRole("button", { name: "Rename" }).click();

    await expect
      .poll(async () => await callsOf(page, "projects", "update"))
      .toContainEqual(
        expect.objectContaining({
          payload: expect.objectContaining({
            collectionId: PROJECT.collectionId,
            name: "Cart",
          }),
        }),
      );
  });

  test("a project move reports the workflows travelling with it", async ({
    page,
  }) => {
    await openProjectsSection(page);

    await page.getByRole("button", { name: /Checkout/ }).click({ button: "right" });
    await page.getByRole("menuitem", { name: "Move to workspace…" }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("1 workflow move");
    // A project move offers no destination project — its own comes along.
    await expect(
      dialog.getByRole("combobox", {
        name: "Project in the destination workspace",
        exact: true,
      }),
    ).toHaveCount(0);

    await page.getByRole("button", { name: "Move" }).click();

    await expect
      .poll(async () => await callsOf(page, "projects", "moveToWorkspace"))
      .toContainEqual(
        expect.objectContaining({
          payload: expect.objectContaining({
            collectionId: PROJECT.collectionId,
            targetWorkspaceId: TEAM.workspaceId,
          }),
        }),
      );
  });
});

test.describe("sidebar row action visuals", () => {
  test.beforeEach(async ({ page }) => {
    await installBridge(page);
  });

  test("captures the workflow menu and the workspace-move dialog", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await navigateDesktop(page, "/personal/workflows");

    await page
      .getByRole("button", { name: /Place order/ })
      .click({ button: "right" });
    await expect(page.getByRole("menu")).toBeVisible();
    await page.screenshot({ path: ".omo/evidence/workflow-context-menu.png" });

    await page.getByRole("menuitem", { name: "Move to workspace…" }).click();
    // The Headless UI dialog root is a zero-size wrapper — its panel is a `fixed`
    // child, so the visible landmark is the select, not the `role="dialog"` node.
    await expect(
      page.getByRole("combobox", { name: "Destination workspace", exact: true }),
    ).toBeVisible();
    await page.screenshot({ path: ".omo/evidence/move-to-workspace-dialog.png" });
  });
});
