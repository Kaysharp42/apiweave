import { expect, test, type Page } from "@playwright/test";
import {
  DESKTOP_WORKFLOW,
  DESKTOP_WORKSPACE,
  captureEvidence,
  installDesktopIpc,
  navigateDesktop,
} from "./fixtures/desktop";

const WORKFLOW_ID = "wf-node-modal";
const WORKFLOW = {
  ...DESKTOP_WORKFLOW,
  workflowId: WORKFLOW_ID,
  workspaceId: DESKTOP_WORKSPACE.workspaceId,
  name: "Node modal visual QA",
  description: "Playwright fixture for the HTTP request editor",
  nodes: [
    {
      nodeId: "request-users",
      type: "http-request",
      label: "Get users",
      position: { x: 240, y: 180 },
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
  edges: [],
} as const;

async function openNodeModal(page: Page): Promise<void> {
  await installDesktopIpc(page);
  await page.addInitScript(() => {
    localStorage.setItem("apiweave:v1:darkMode", "true");
    localStorage.setItem("darkMode", "true");
  });
  await page.addInitScript((workflow) => {
    const bridge = window.__APIWEAVE_IPC__;
    if (!bridge) return;
    const invoke = bridge.invoke;
    bridge.invoke = async (domain, action, payload) => {
      if (domain === "workflows" && action === "list") {
        return { ok: true as const, data: { items: [workflow], total: 1 } };
      }
      if (
        domain === "workflows" &&
        (action === "get" || action === "update")
      ) {
        return { ok: true as const, data: workflow };
      }
      return invoke(domain, action, payload);
    };
  }, WORKFLOW);

  await navigateDesktop(page, `/${DESKTOP_WORKSPACE.slug}/workflows/${WORKFLOW_ID}`);

  const workflowButton = page.getByRole("button", {
    name: /Node modal visual QA/,
  });
  let openedSidebar = false;
  if (!(await workflowButton.isVisible())) {
    await page.getByRole("button", { name: "Toggle sidebar" }).click();
    openedSidebar = true;
  }
  await workflowButton.click();
  if (openedSidebar) {
    await page.locator("[aria-hidden='true'].fixed.inset-0.z-40").click({
      position: { x: 1, y: 1 },
    });
  }

  const requestNode = page
    .locator(".react-flow__node")
    .filter({ hasText: "Get users" })
    .first();
  await expect(requestNode).toBeAttached();
  const nodeLabel = requestNode.getByText("Get users", { exact: true });
  if (await nodeLabel.isVisible()) await nodeLabel.dblclick();
  else await nodeLabel.dispatchEvent("dblclick");
  await expect(page.getByLabel("Node name")).toBeVisible();
}

test.describe("NodeModal visual QA", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("uses one coherent request editor across every HTTP tab", async ({
    page,
  }) => {
    await openNodeModal(page);
    const dialog = page.getByRole("dialog");
    const tabs = dialog.getByRole("tab");

    await expect(tabs).toHaveCount(6);
    await expect(dialog.getByLabel("Request URL")).toHaveValue(
      "https://api.example.com/users",
    );

    const paramsBox = await dialog
      .getByRole("tab", { name: "Params" })
      .boundingBox();
    const authBox = await dialog
      .getByRole("tab", { name: "Auth" })
      .boundingBox();
    expect(paramsBox).not.toBeNull();
    expect(authBox).not.toBeNull();
    expect(Math.abs((paramsBox?.y ?? 0) - (authBox?.y ?? 0))).toBeLessThan(2);
    expect((authBox?.x ?? 0) - (paramsBox?.x ?? 0)).toBeGreaterThan(0);

    const methodSelect = dialog.getByRole("button", {
      name: "GET",
      exact: true,
    });
    await methodSelect.click();
    const methodMenu = dialog.getByRole("listbox");
    await expect(methodMenu).toBeVisible();
    const methodSelectBox = await methodSelect.boundingBox();
    const methodMenuBox = await methodMenu.boundingBox();
    expect(methodMenuBox?.x).toBe(methodSelectBox?.x);
    expect(methodMenuBox?.width).toBe(methodSelectBox?.width);
    await captureEvidence(page, "node-modal-method-menu-1440.png", {
      fullPage: false,
    });
    await dialog.getByRole("option", { name: "POST" }).click();

    await captureEvidence(page, "node-modal-params-1440.png", {
      fullPage: false,
    });

    await dialog.getByRole("tab", { name: "Auth" }).click();
    await expect(dialog.getByText("Authorization")).toBeVisible();
    const authSelect = dialog.getByRole("button", {
      name: "None",
      exact: true,
    });
    await authSelect.click();
    await expect(dialog.getByRole("listbox")).toBeVisible();
    await dialog.getByRole("option", { name: "Bearer Token" }).click();
    await expect(dialog.getByPlaceholder("{{secrets.API_TOKEN}}")).toBeVisible();
    await captureEvidence(page, "node-modal-auth-1440.png", {
      fullPage: false,
    });

    await dialog.getByRole("tab", { name: "Headers" }).click();
    await expect(dialog.getByText("Header rows")).toBeVisible();
    await captureEvidence(page, "node-modal-headers-1440.png", {
      fullPage: false,
    });

    await dialog.getByRole("tab", { name: "Body" }).click();
    await expect(dialog.getByRole("tab", { name: "Body" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(dialog.getByRole("tab", { name: "Params" })).toHaveAttribute(
      "aria-selected",
      "false",
    );
    await expect(dialog.getByText("Body type")).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: "JSON", exact: true }),
    ).toBeVisible();
    await expect(dialog.locator(".monaco-editor")).toBeVisible();
    const jsonEditorBox = await dialog.locator(".monaco-editor").boundingBox();
    await captureEvidence(page, "node-modal-body-json-1440.png", {
      fullPage: false,
    });

    await dialog
      .getByRole("button", { name: "JSON", exact: true })
      .click();
    await dialog.getByRole("option", { name: "Raw" }).click();
    const rawEditor = dialog.locator("textarea");
    await expect(rawEditor).toBeVisible();
    const rawEditorBox = await rawEditor.boundingBox();
    expect(rawEditorBox?.height).toBe(jsonEditorBox?.height);
    await captureEvidence(page, "node-modal-body-raw-1440.png", {
      fullPage: false,
    });

    await dialog.getByRole("button", { name: "Raw", exact: true }).click();
    await dialog.getByRole("option", { name: "Form-data" }).click();
    await expect(dialog.getByText("No form-data rows")).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Add row" })).toBeVisible();
    await captureEvidence(page, "node-modal-body-form-data-1440.png", {
      fullPage: false,
    });

    await dialog
      .getByRole("button", { name: "Form-data", exact: true })
      .click();
    await dialog
      .getByRole("option", { name: "x-www-form-urlencoded" })
      .click();
    await expect(dialog.getByText("URL encoded fields")).toBeVisible();
    await captureEvidence(page, "node-modal-body-urlencoded-1440.png", {
      fullPage: false,
    });

    await dialog
      .getByRole("button", { name: "x-www-form-urlencoded", exact: true })
      .click();
    await dialog.getByRole("option", { name: "Binary" }).click();
    await expect(dialog.getByText("Binary file", { exact: true })).toBeVisible();
    await captureEvidence(page, "node-modal-body-binary-1440.png", {
      fullPage: false,
    });

    await dialog.getByRole("button", { name: "Binary", exact: true }).click();
    await dialog.getByRole("option", { name: "None" }).click();
    await expect(dialog.getByText("No request body")).toBeVisible();
    await captureEvidence(page, "node-modal-body-none-1440.png", {
      fullPage: false,
    });

    await dialog.getByRole("tab", { name: "Cookies" }).click();
    await expect(dialog.getByText("Cookie rows")).toBeVisible();
    await captureEvidence(page, "node-modal-cookies-1440.png", {
      fullPage: false,
    });

    await dialog.getByRole("tab", { name: "Settings" }).click();
    await expect(
      dialog.getByRole("tab", { name: "Settings" }),
    ).toHaveAttribute("aria-selected", "true");
    await expect(dialog.getByText("Store response as variables")).toBeVisible();

    await captureEvidence(page, "node-modal-settings-1440.png", {
      fullPage: false,
    });
  });
});

for (const viewport of [
  { name: "768", width: 768, height: 1024 },
  { name: "375", width: 375, height: 812 },
] as const) {
  test.describe(`NodeModal responsive QA at ${viewport.name}px`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test("keeps tabs usable without horizontal page overflow", async ({
      page,
    }) => {
      await openNodeModal(page);
      const dialog = page.getByRole("dialog");

      await dialog.getByRole("tab", { name: "Body" }).click();
      await expect(dialog.getByText("Body type")).toBeVisible();
      await expect(dialog.getByRole("tab", { name: "Settings" })).toBeVisible();
      await expect(dialog.locator(".monaco-editor")).toBeVisible();

      if (viewport.width < 768) {
        await expect(
          page.getByRole("button", { name: "Show response" }),
        ).toBeVisible();
      } else {
        await expect(
          page.getByRole("button", { name: "Hide response" }),
        ).toBeVisible();
      }

      const hasHorizontalOverflow = await page.evaluate(
        () =>
          document.documentElement.scrollWidth >
          document.documentElement.clientWidth,
      );
      expect(hasHorizontalOverflow).toBe(false);

      await captureEvidence(page, `node-modal-body-${viewport.name}.png`, {
        fullPage: false,
      });
    });
  });
}
