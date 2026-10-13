import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { McpSetupPanel } from "./McpSetupPanel";
import type { McpStatus } from "@shared/types/McpStatus";
import type { AgentRunApproval } from "@shared/types/AgentRunApproval";

const status: McpStatus = {
  running: true,
  config: { url: "http://127.0.0.1:47271/mcp", token: "token-1", port: 47271 },
};

const approval: AgentRunApproval = {
  approvalId: "a-1",
  workspaceId: "ws-1",
  agent: "claude-code",
  workflowId: "wf-1",
  workflowName: "Checkout",
  secretNames: ["API_KEY", "DB_PASS"],
  destinations: ["api.example.com"],
  runsScripts: false,
  createdAt: "2026-10-13T00:00:00.000Z",
};

const revokeAgentApproval = vi.fn((_approvalId: string) => Promise.resolve(true));

function installBridge(approvals: readonly AgentRunApproval[]): void {
  (window as unknown as Record<string, unknown>)["__APIWEAVE_MCP__"] = {
    getStatus: () => Promise.resolve(status),
    enable: () => Promise.resolve(status),
    disable: () => Promise.resolve(status),
    regenerateToken: () => Promise.resolve(status),
    listAgentApprovals: () => Promise.resolve(approvals),
    revokeAgentApproval,
    listTools: () => Promise.resolve([]),
    listPrompts: () => Promise.resolve([]),
    listResources: () => Promise.resolve([]),
    testConnection: () => Promise.resolve({ ok: true, status: 200 }),
  };
}

afterEach(() => {
  delete (window as unknown as Record<string, unknown>)["__APIWEAVE_MCP__"];
  revokeAgentApproval.mockClear();
});

describe("McpSetupPanel remembered approvals", () => {
  it("lists a remembered approval and revokes it", async () => {
    installBridge([approval]);
    render(<McpSetupPanel />);

    expect(await screen.findByText(/Remembered approvals/i)).toBeTruthy();
    expect(await screen.findByText("Checkout")).toBeTruthy();
    expect(screen.getByText(/API_KEY, DB_PASS/)).toBeTruthy();
    expect(screen.getByText(/api\.example\.com/)).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: /revoke/i }));

    expect(revokeAgentApproval).toHaveBeenCalledWith("a-1");
    await waitFor(() => {
      expect(screen.queryByText("Checkout")).toBeNull();
    });
  });

  it("stays out of the way when nothing has been remembered", async () => {
    installBridge([]);
    render(<McpSetupPanel />);

    await waitFor(() => {
      expect(screen.queryByText(/Remembered approvals/i)).toBeNull();
    });
    expect(screen.queryByRole("button", { name: /revoke/i })).toBeNull();
  });
});
