// @vitest-environment jsdom
import "../../../__tests__/setup";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CreateWorkspaceModal } from "../CreateWorkspaceModal";
import type { Workspace } from "../../../types/Workspace";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const created: Workspace = {
  workspaceId: "ws-new",
  slug: "qa-workspace",
  name: "QA Workspace",
  description: null,
  isPersonal: false,
  origin: "local",
  syncMode: "none",
  deletedAt: null,
  rev: 1,
  createdAt: "2026-07-19T00:00:00.000Z",
  updatedAt: "2026-07-19T00:00:00.000Z",
} as unknown as Workspace;

const linkedStatus = {
  linked: true,
  active: true,
  linkState: "linked",
  syncState: "idle",
  state: "idle",
  pendingCount: 0,
  deadLetterCount: 0,
  conflictCount: 0,
  workspaceIds: [],
  bindings: [],
  workspaceCatalog: [],
  teamCatalog: [
    {
      teamId: "team-platform",
      teamName: "Platform",
      isPersonal: false,
      canCreateWorkspaces: true,
    },
  ],
};

function stubBridge(status: typeof linkedStatus | null = null) {
  const invoke = vi.fn(async (domain: string, action: string) => ({
    ok: true as const,
    data: domain === "cloud" && action === "status" ? status ?? { ...linkedStatus, linked: false, teamCatalog: [] } : created,
  }));
  const bridge = {
    invoke,
    onRunProgress: vi.fn().mockReturnValue(() => undefined),
    onCloudStatusChanged: vi.fn().mockReturnValue(() => undefined),
  };
  vi.stubGlobal("__APIWEAVE_IPC__", bridge);
  Object.defineProperty(window, "__APIWEAVE_IPC__", {
    value: bridge,
    configurable: true,
  });
  return invoke;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("CreateWorkspaceModal (desktop)", () => {
  it("creates a non-personal workspace over IPC", async () => {
    const invoke = stubBridge();
    const onCreated = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();

    render(
      <CreateWorkspaceModal
        isOpen
        onClose={() => undefined}
        onCreated={onCreated}
      />,
    );

    await user.type(
      screen.getByPlaceholderText("QA Workspace"),
      "QA Workspace",
    );
    await user.click(screen.getByRole("button", { name: "Create workspace" }));

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(created));
    expect(invoke).toHaveBeenCalledWith(
      "workspaces",
      "create",
      expect.objectContaining({
        name: "QA Workspace",
        slug: "qa-workspace",
        isPersonal: false,
      }),
    );
  });

  it("creates and attaches a workspace to an existing Cloud Team", async () => {
    const invoke = stubBridge(linkedStatus);
    const user = userEvent.setup();
    render(
      <CreateWorkspaceModal isOpen onClose={() => undefined} onCreated={vi.fn()} />,
    );

    await user.click(await screen.findByRole("radio", { name: /Existing Cloud Team/i }));
    await user.type(screen.getByPlaceholderText("QA Workspace"), "Checkout APIs");
    await user.click(screen.getByRole("button", { name: "Create workspace" }));

    await waitFor(() => expect(invoke).toHaveBeenCalledWith(
      "cloud",
      "createTeamWorkspace",
      expect.objectContaining({
        name: "Checkout APIs",
        slug: "checkout-apis",
        teamId: "team-platform",
      }),
    ));
  });

  it("creates a new Cloud Team with its first workspace", async () => {
    const invoke = stubBridge(linkedStatus);
    const user = userEvent.setup();
    render(
      <CreateWorkspaceModal isOpen onClose={() => undefined} onCreated={vi.fn()} />,
    );

    await user.click(await screen.findByRole("radio", { name: /New Cloud Team/i }));
    await user.type(screen.getByPlaceholderText("Platform Engineering"), "Payments");
    await user.type(screen.getByPlaceholderText("QA Workspace"), "Checkout APIs");
    await user.click(screen.getByRole("button", { name: "Create workspace" }));

    await waitFor(() => expect(invoke).toHaveBeenCalledWith(
      "cloud",
      "createTeamWorkspace",
      expect.objectContaining({
        name: "Checkout APIs",
        newTeamName: "Payments",
      }),
    ));
  });
});
