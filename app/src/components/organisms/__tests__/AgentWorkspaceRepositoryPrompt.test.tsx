// @vitest-environment jsdom
import "../../../__tests__/setup";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import type { AgentWriteEvent } from "@shared/types/AgentWriteEvent";
import type { GitAccount } from "@shared/types/GitAccount";
import { AgentWorkspaceRepositoryPrompt } from "../AgentWorkspaceRepositoryPrompt";
import { installGitBridge, untrackedStatus } from "../../../__tests__/gitFixtures";
import type { Workspace } from "../../../types/Workspace";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("../../../contexts/WorkspaceContext", () => ({
  useWorkspace: () => ({ currentOrg: { slug: "personal" } }),
}));

const WORK: GitAccount = { provider: "github", host: "github.com", login: "octo-work", gitProtocol: "https", active: true, problem: null };
const WORK_REF = { provider: "github" as const, host: "github.com", login: "octo-work" };

const workspace = (workspaceId: string, name: string, slug: string): Workspace =>
  ({ workspaceId, name, slug, description: null, isPersonal: false, deletedAt: null, rev: 1, createdAt: "", updatedAt: "" }) as unknown as Workspace;

const WORKSPACES: Record<string, Workspace> = {
  "ws-a": workspace("ws-a", "Browser checks", "browser-checks"),
  "ws-b": workspace("ws-b", "Orders API", "orders-api"),
};

/** Stub the IPC bridge: `workspaces.get` answers from WORKSPACES, and agent writes can be pushed. */
function stubIpc(): (event: AgentWriteEvent) => void {
  const listeners = new Set<(event: AgentWriteEvent) => void>();
  const bridge = {
    invoke: vi.fn(async (_domain: string, _action: string, payload: { workspaceId: string }) => {
      const found = WORKSPACES[payload.workspaceId];
      return found === undefined ? { ok: false as const, error: { code: "NOT_FOUND", message: "not found" } } : { ok: true as const, data: found };
    }),
    onRunProgress: vi.fn().mockReturnValue(() => undefined),
    onAgentWrite: (callback: (event: AgentWriteEvent) => void) => {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
  };
  Object.defineProperty(window, "__APIWEAVE_IPC__", { value: bridge, configurable: true });
  return (event) => act(() => listeners.forEach((listener) => listener(event)));
}

function renderPrompt(): void {
  render(
    <MemoryRouter>
      <AgentWorkspaceRepositoryPrompt />
    </MemoryRouter>,
  );
}

const created = (workspaceId: string): AgentWriteEvent => ({ domain: "workspaces", action: "create", workspaceId });

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("AgentWorkspaceRepositoryPrompt", () => {
  it("asks about a workspace an agent created, then creates its repository and connects it", async () => {
    const push = stubIpc();
    const { bridge } = installGitBridge(untrackedStatus, { listAccounts: vi.fn(async () => ({ clis: [], accounts: [WORK] })) });
    const user = userEvent.setup();
    renderPrompt();

    push(created("ws-a"));

    expect(await screen.findByRole("dialog")).toHaveTextContent("An agent created the workspace Browser checks");
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Owner" })).toHaveValue("octo-work"));
    expect(screen.getByRole("textbox", { name: "Repository name" })).toHaveValue("browser-checks");
    await user.click(screen.getByRole("button", { name: "Create repository" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(bridge.track).toHaveBeenCalledWith("ws-a");
    expect(bridge.createRepository).toHaveBeenCalledWith(WORK_REF, { owner: "octo-work", name: "browser-checks", private: true });
    expect(bridge.connectRemote).toHaveBeenCalledWith("ws-a", "https://github.com/octo-work/browser-checks.git", WORK_REF);
    expect(toast.success).toHaveBeenCalledWith('"Browser checks" is synced with github.com', undefined);
  });

  it("creates nothing on Not now, and asks about the next workspace in turn", async () => {
    const push = stubIpc();
    const { bridge } = installGitBridge(untrackedStatus, { listAccounts: vi.fn(async () => ({ clis: [], accounts: [WORK] })) });
    const user = userEvent.setup();
    renderPrompt();

    push(created("ws-a"));
    push(created("ws-b"));
    push(created("ws-a"));

    expect(await screen.findByRole("dialog")).toHaveTextContent("Browser checks");
    await user.click(screen.getByRole("button", { name: "Not now" }));
    expect(await screen.findByRole("dialog")).toHaveTextContent("Orders API");
    await user.click(screen.getByRole("button", { name: "Not now" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(bridge.track).not.toHaveBeenCalled();
    expect(bridge.createRepository).not.toHaveBeenCalled();
  });

  it("asks nothing for other writes, a workspace opened from git, or one already deleted", async () => {
    const push = stubIpc();
    installGitBridge(untrackedStatus, { listAccounts: vi.fn(async () => ({ clis: [], accounts: [WORK] })) });
    renderPrompt();

    push({ domain: "workflows", action: "create", workspaceId: "ws-a" });
    push({ domain: "workspaces", action: "gitImport", workspaceId: "ws-a" });
    push({ domain: "workspaces", action: "create" });
    push(created("ws-gone"));

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("asks nothing without the desktop's git bridge", async () => {
    const push = stubIpc();
    renderPrompt();

    push(created("ws-a"));

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
