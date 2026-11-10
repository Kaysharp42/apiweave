import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { McpSetupPanel } from "./McpSetupPanel";
import type { McpStatus } from "@shared/types/McpStatus";
import type { AgentRunApproval } from "@shared/types/AgentRunApproval";
import type { AgentMcpConnection } from "@shared/types/AgentMcpConnection";
import type { AgentMcpConnections } from "@shared/types/AgentMcpConnections";

const status: McpStatus = {
  running: true,
  config: { url: "http://127.0.0.1:47271/mcp", token: "token-1", port: 47271 },
  launcherPath: "C:\\Users\\me\\AppData\\Roaming\\APIWeave\\apiweave-mcp.cjs",
  autoApproveAgentRuns: false,
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
const setAutoApproveAgentRuns = vi.fn((_enabled: boolean) =>
  Promise.resolve({ ...status, autoApproveAgentRuns: true }),
);

const opencode: AgentMcpConnection = {
  clientId: "opencode",
  name: "OpenCode",
  state: "outdated",
  configPath: "C:\\Users\\me\\.config\\opencode\\opencode.json",
  detail: "Has a direct HTTP entry, which fails whenever APIWeave is closed.",
};
const connections: AgentMcpConnections = {
  clients: [opencode],
  nodePath: "C:\\Program Files\\nodejs\\node.exe",
  nodeProblem: null,
};
const connectAgent = vi.fn((_clientId: string) =>
  Promise.resolve<AgentMcpConnections>({
    ...connections,
    clients: [{ ...opencode, state: "connected", detail: null }],
  }),
);

function installBridge(
  approvals: readonly AgentRunApproval[],
  agents: AgentMcpConnections = connections,
): void {
  (window as unknown as Record<string, unknown>)["__APIWEAVE_MCP__"] = {
    getStatus: () => Promise.resolve(status),
    enable: () => Promise.resolve(status),
    disable: () => Promise.resolve(status),
    regenerateToken: () => Promise.resolve(status),
    listAgentApprovals: () => Promise.resolve(approvals),
    revokeAgentApproval,
    setAutoApproveAgentRuns,
    listAgentConnections: () => Promise.resolve(agents),
    connectAgent,
    disconnectAgent: () => Promise.resolve(agents),
  };
}

afterEach(() => {
  delete (window as unknown as Record<string, unknown>)["__APIWEAVE_MCP__"];
  revokeAgentApproval.mockClear();
  setAutoApproveAgentRuns.mockClear();
  connectAgent.mockClear();
});

describe("McpSetupPanel connect your agents", () => {
  it("replaces an old entry only when the user clicks", async () => {
    installBridge([]);
    render(<McpSetupPanel />);

    expect(await screen.findByText("OpenCode")).toBeTruthy();
    expect(screen.getByText("Old entry")).toBeTruthy();
    expect(connectAgent).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Replace" }));

    expect(connectAgent).toHaveBeenCalledWith("opencode");
    expect(await screen.findByText("Connected")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Disconnect" })).toBeTruthy();
  });

  it("says Node.js is missing and offers nothing to click", async () => {
    installBridge([], {
      ...connections,
      nodePath: null,
      nodeProblem: "Node.js was not found on PATH. Install Node.js 20 or newer, then refresh.",
    });
    render(<McpSetupPanel />);

    expect(await screen.findByText(/Node\.js was not found on PATH/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Replace" }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("McpSetupPanel client configs", () => {
  it("recommends the launcher, with no token in it, and says it needs Node.js", async () => {
    installBridge([]);
    render(<McpSetupPanel />);

    const launcher = (await screen.findByText(/"command": "node"/)).textContent ?? "";
    expect(JSON.parse(launcher)).toEqual({
      mcpServers: { apiweave: { command: "node", args: [status.launcherPath] } },
    });
    expect(launcher).not.toContain("token-1");
    expect(screen.getByText(/Node\.js 20 or newer/)).toBeTruthy();
    // The direct HTTP config stays, for clients that cannot run a command.
    expect(screen.getByText(/Bearer token-1/)).toBeTruthy();
  });
});

describe("McpSetupPanel agent approvals", () => {
  it("skips the secret approval question for agent runs", async () => {
    installBridge([]);
    render(<McpSetupPanel />);

    const toggle = (await screen.findByRole("checkbox", {
      name: /skip secret approval for agent runs/i,
    })) as HTMLInputElement;
    expect(toggle.checked).toBe(false);

    await userEvent.click(toggle);

    expect(setAutoApproveAgentRuns).toHaveBeenCalledWith(true);
    await waitFor(() => {
      expect(toggle.checked).toBe(true);
    });
  });

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
