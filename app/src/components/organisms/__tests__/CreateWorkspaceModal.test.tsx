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

function stubBridge() {
  const invoke = vi.fn(async () => ({ ok: true, data: created }));
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
});
