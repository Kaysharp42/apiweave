// @vitest-environment jsdom
import "../../../__tests__/setup";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { WorkspaceProvider } from "../../../contexts/WorkspaceContext";
import type { Workspace } from "../../../types/Workspace";
import {
  installGitBridge,
  trackedStatus,
} from "../../../__tests__/gitFixtures";

/**
 * Create workspace through the switcher, over the real workspace context:
 * creating refreshes the list, and the refresh is what used to unmount the
 * dialog — and with it everything the dialog had to say about the workspace
 * it had just created.
 */

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const PERSONAL: Workspace = {
  workspaceId: "ws-personal",
  slug: "personal",
  name: "Personal",
  description: null,
  isPersonal: true,
  deletedAt: null,
  rev: 1,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
} as unknown as Workspace;

const CREATED: Workspace = {
  ...PERSONAL,
  workspaceId: "ws-new",
  slug: "qa-workspace",
  name: "QA Workspace",
  isPersonal: false,
};

function stubDesktopIpc(): { readonly list: ReturnType<typeof vi.fn> } {
  const list = vi.fn(async () => [PERSONAL, CREATED]);
  const invoke = vi.fn(async (domain: string, action: string) => {
    if (domain === "workspaces" && action === "list")
      return { ok: true as const, data: await list() };
    if (domain === "workspaces" && action === "create")
      return { ok: true as const, data: CREATED };
    return { ok: true as const, data: null };
  });
  vi.stubGlobal("__APIWEAVE_IPC__", {
    invoke,
    onRunProgress: () => () => undefined,
  });
  Object.defineProperty(window, "__APIWEAVE_IPC__", {
    value: { invoke, onRunProgress: () => () => undefined },
    configurable: true,
  });
  return { list };
}

async function openCreateWorkspace(
  user: ReturnType<typeof userEvent.setup>,
): Promise<HTMLElement> {
  await user.click(
    await screen.findByRole("button", { name: "Switch workspace" }),
  );
  await user.click(screen.getByRole("button", { name: "New workspace" }));
  return screen.findByRole("dialog", { name: "Create workspace" });
}

async function fillAndSync(
  user: ReturnType<typeof userEvent.setup>,
  dialog: HTMLElement,
): Promise<void> {
  await user.type(
    within(dialog).getByPlaceholderText("QA Workspace"),
    "QA Workspace",
  );
  await user.click(
    within(dialog).getByRole("checkbox", {
      name: "Sync with GitHub or GitLab",
    }),
  );
  await waitFor(() =>
    expect(within(dialog).getByRole("combobox", { name: "Owner" })).toHaveValue(
      "octo-work",
    ),
  );
}

describe("OrgWorkspaceSwitcher's Create workspace", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("keeps the dialog open through its refresh, so the author it asks for is shown", async () => {
    const { list } = stubDesktopIpc();
    const needsAuthor = trackedStatus({
      workspaceId: "ws-new",
      remoteUrl: null,
      lastCommit: null,
      lastError: {
        code: "identity_missing",
        message: "Author identity unknown",
      },
    });
    installGitBridge(needsAuthor, {
      track: vi.fn(async () => needsAuthor),
      listAccounts: vi.fn(async () => ({
        clis: [],
        accounts: [
          {
            provider: "github" as const,
            host: "github.com",
            login: "octo-work",
            gitProtocol: "https" as const,
            active: true,
            problem: null,
          },
        ],
      })),
    });
    const user = userEvent.setup();
    const { OrgWorkspaceSwitcher } = await import("../OrgWorkspaceSwitcher");
    render(
      <MemoryRouter initialEntries={["/personal/personal/workflows"]}>
        <WorkspaceProvider>
          <OrgWorkspaceSwitcher />
        </WorkspaceProvider>
      </MemoryRouter>,
    );

    const dialog = await openCreateWorkspace(user);
    await fillAndSync(user, dialog);
    await user.click(
      within(dialog).getByRole("button", { name: "Create workspace" }),
    );

    // The list is refreshed — the switcher's trigger is a skeleton while it is — and the dialog is still
    // there afterwards, asking for the author rather than starting again blank.
    expect(list).toHaveBeenCalled();
    expect(
      await within(dialog).findByText(/Tell git who is making its commits/),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("textbox", { name: "Your name" }),
    ).toBeInTheDocument();
  });
});
