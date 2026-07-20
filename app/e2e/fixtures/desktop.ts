import type { Page } from "@playwright/test";

export const DESKTOP_WORKSPACE = {
  workspaceId: "workspace-personal",
  slug: "personal",
  name: "Personal",
  description: "Local workspace",
  isPersonal: true,
  origin: "local",
  syncMode: "local_only",
  rev: 0,
  createdAt: "2026-07-20T00:00:00.000Z",
  updatedAt: "2026-07-20T00:00:00.000Z",
} as const;

export const DESKTOP_WORKFLOW = {
  workflowId: "workflow-smoke",
  workspaceId: DESKTOP_WORKSPACE.workspaceId,
  name: "Desktop smoke workflow",
  description: "Canonical Playwright fixture",
  nodes: [
    {
      nodeId: "start-1",
      type: "start",
      label: "Start",
      position: { x: 80, y: 140 },
      config: {},
    },
    {
      nodeId: "request-1",
      type: "http-request",
      label: "Get users",
      position: { x: 320, y: 140 },
      config: {
        method: "GET",
        url: "https://api.example.com/users",
        queryParams: [{ key: "page", value: "1" }],
        headers: [{ key: "Accept", value: "application/json" }],
        cookies: [],
        bodyType: "json",
        body: '{\n  "active": true\n}',
        timeout: 30,
        followRedirects: true,
        sslVerify: true,
        continueOnFail: false,
      },
    },
  ],
  edges: [
    {
      edgeId: "edge-start-request",
      source: "start-1",
      target: "request-1",
      sourceHandle: null,
      targetHandle: null,
      label: null,
    },
  ],
  variables: {},
  tags: ["smoke"],
  collectionId: null,
  selectedEnvironmentId: null,
  nodeTemplates: [],
  rev: 0,
  createdAt: "2026-07-20T00:00:00.000Z",
  updatedAt: "2026-07-20T00:00:00.000Z",
} as const;

export async function installDesktopIpc(page: Page): Promise<void> {
  await page.addInitScript(
    ({ workflow, workspace }) => {
      window.__APIWEAVE_IPC__ = {
        invoke: async (domain, action) => {
          let data: unknown = null;
          let handled = false;
          if (domain === "workspaces" && action === "list") {
            data = [workspace];
            handled = true;
          }
          if (domain === "workflows" && action === "list") {
            data = { items: [workflow], total: 1 };
            handled = true;
          }
          if (
            domain === "workflows" &&
            (action === "get" || action === "update")
          ) {
            data = workflow;
            handled = true;
          }
          if (
            ["environments", "projects", "runs"].includes(domain) &&
            action.startsWith("list")
          ) {
            data = { items: [], total: 0 };
            handled = true;
          }
          if (
            domain === "runs" &&
            (action === "getLatest" || action === "getLatestFailed")
          ) {
            data = null;
            handled = true;
          }
          if (domain === "secrets" && action === "list") {
            data = [];
            handled = true;
          }
          if (domain === "cloud" && action === "status") {
            data = {
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
            };
            handled = true;
          }
          if (!handled) {
            return {
              ok: false as const,
              error: {
                code: "not_found" as const,
                message: `Unhandled E2E IPC call: ${domain}.${action}`,
              },
            };
          }
          return { ok: true as const, data };
        },
        onRunProgress: () => () => undefined,
        onCloudStatusChanged: () => () => undefined,
      };
    },
    { workflow: DESKTOP_WORKFLOW, workspace: DESKTOP_WORKSPACE },
  );
}

export async function navigateDesktop(
  page: Page,
  path: string,
): Promise<void> {
  await page.goto(`/#${path}`);
  await page.waitForLoadState("domcontentloaded");
}

export async function captureEvidence(
  page: Page,
  filename: string,
  options: Parameters<Page["screenshot"]>[0] = {},
): Promise<void> {
  await page.screenshot({
    ...options,
    path: `.omo/evidence/${filename}`,
  });
}
