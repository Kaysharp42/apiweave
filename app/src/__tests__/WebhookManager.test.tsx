import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WebhookManager } from "../components/WebhookManager";
import type { Webhook } from "../types/Webhook";
import { authenticatedFetch } from "../utils/apiweaveClient";
import { toast } from "sonner";

vi.mock("../utils/apiweaveClient", async (importOriginal) => ({
  ...((await importOriginal()) as object),
  authenticatedFetch: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

vi.mock("../hooks/useScopeContext", () => ({
  useScopeContext: () => ({
    workspaceId: "ws-1",
    workspaceSlug: "test-workspace",
    orgId: "org-1",
    orgSlug: "test-org",
    userId: "user-1",
    isReady: true,
  }),
}));

const mockWebhook: Webhook = {
  webhookId: "wh-123",
  resourceType: "workflow",
  resourceId: "wf-456",
  enabled: true,
  url: "http://localhost:8000/api/webhooks/workflows/wh-123/execute",
  usageCount: 5,
  lastStatus: "success",
};

const mockWorkflows = [
  { workflowId: "wf-456", name: "Test Workflow", nodes: [], edges: [] },
];

/** Match scoped workspace URLs: /api/workspaces/{id}/... */
function isScopedWorkflowsUrl(url: string): boolean {
  return /\/api\/workspaces\/[^/]+\/workflows/.test(url);
}

function isScopedProjectsUrl(url: string): boolean {
  return /\/api\/workspaces\/[^/]+\/projects/.test(url);
}

function isScopedEnvironmentsUrl(url: string): boolean {
  return /\/api\/workspaces\/[^/]+\/environments/.test(url);
}

describe("WebhookManager", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    (authenticatedFetch as ReturnType<typeof vi.fn>).mockImplementation(
      (url: string) => {
        if (url.includes("/execute")) {
          return Promise.resolve({
            ok: false,
            status: 401,
            json: () => Promise.resolve({ detail: "no token" }),
          });
        }
        if (isScopedWorkflowsUrl(url)) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve(mockWorkflows),
          });
        }
        if (isScopedProjectsUrl(url)) {
          return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
        }
        if (isScopedEnvironmentsUrl(url)) {
          return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
        }
        if (url.includes("/api/webhooks/") && url.includes("/logs")) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ logs: [] }),
          });
        }
        if (url.includes("/api/webhooks/")) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve([mockWebhook]),
          });
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      },
    );
  });

  it("renders test delivery button for enabled webhooks", async () => {
    render(<WebhookManager />);

    await waitFor(() => {
      expect(screen.getByText("Test Workflow")).toBeInTheDocument();
    });

    const testDeliveryButtons = screen.getAllByText("Test Delivery");
    expect(testDeliveryButtons.length).toBeGreaterThan(0);
  });

  it("shows runId in toast after successful test delivery", async () => {
    const user = userEvent.setup();

    (authenticatedFetch as ReturnType<typeof vi.fn>).mockImplementation(
      (url: string, options?: RequestInit) => {
        if (url.includes("/execute") && options?.method === "POST") {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({ runId: "run-789", status: "accepted" }),
          });
        }
        if (isScopedWorkflowsUrl(url)) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve(mockWorkflows),
          });
        }
        if (isScopedProjectsUrl(url)) {
          return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
        }
        if (isScopedEnvironmentsUrl(url)) {
          return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
        }
        if (url.includes("/api/webhooks/") && url.includes("/logs")) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ logs: [] }),
          });
        }
        if (url.includes("/api/webhooks/")) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve([mockWebhook]),
          });
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      },
    );

    render(<WebhookManager />);

    await waitFor(() => {
      expect(screen.getByText("Test Workflow")).toBeInTheDocument();
    });

    const testDeliveryButton = screen.getAllByText("Test Delivery")[0];
    if (!testDeliveryButton) throw new Error("Test Delivery button not found");
    await user.click(testDeliveryButton);

    await waitFor(
      () => {
        expect(toast.success).toHaveBeenCalledWith(
          expect.stringContaining("run-789"),
        );
      },
      { timeout: 3000 },
    );
  });
});
