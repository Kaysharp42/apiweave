// @vitest-environment jsdom
import "../../../__tests__/setup";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CloudSyncPage } from "../CloudSyncPage";
import type {
  CloudSyncStatus,
  CloudWorkspaceBinding,
} from "../../../types/cloud";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const base: CloudSyncStatus = {
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
  teamCatalog: [],
  encryptionDecisionPending: [],
  account: { accountId: "acc-1", email: "user@example.com" },
};

function binding(
  overrides: Partial<CloudWorkspaceBinding> = {},
): CloudWorkspaceBinding {
  return {
    workspaceId: "local-1",
    workspaceName: "Personal",
    cloudWorkspaceId: "cloud-1",
    cloudWorkspaceName: "Personal",
    syncMode: "bi-directional",
    initializationState: "initialized",
    pendingCount: 0,
    deadLetterCount: 0,
    conflictCount: 0,
    boundAt: "2026-07-16T00:00:00.000Z",
    encryption: "plaintext",
    ...overrides,
  };
}

/**
 * Installs the fake IPC bridge the renderer talks to. `failures` lets one action
 * reject with the same envelope main would send — the discriminating detail flag
 * is the whole point of the wrong-passphrase test.
 */
function setStatus(
  status: CloudSyncStatus,
  failures: Record<
    string,
    {
      readonly code: string;
      readonly message: string;
      readonly details?: unknown;
    }
  > = {},
): ReturnType<typeof vi.fn> {
  const invoke = vi.fn(async (_domain: string, action: string) => {
    const failure = failures[action];
    if (failure) return { ok: false, error: failure };
    return { ok: true, data: status };
  });
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

function renderPage(): void {
  render(
    <MemoryRouter>
      <CloudSyncPage />
    </MemoryRouter>,
  );
}

function cloudActions(invoke: ReturnType<typeof vi.fn>): string[] {
  return invoke.mock.calls
    .filter(([domain]) => domain === "cloud")
    .map(([, action]) => action as string);
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("CloudSyncPage encryption decisions", () => {
  it("prompts for a pending decision and says both answers are permanent before the choice", async () => {
    setStatus({
      ...base,
      encryptionDecisionPending: [
        { workspaceId: "local-9", workspaceName: "Payments" },
      ],
    });
    renderPage();

    await waitFor(() =>
      expect(
        screen.getByText("Waiting on an encryption choice"),
      ).toBeInTheDocument(),
    );
    expect(screen.getByText("Both answers are permanent")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Encrypt this workspace" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Sync without encryption" }),
    ).toBeInTheDocument();
  });

  it("declining calls declineWorkspaceEncryption, never setWorkspaceEncryption", async () => {
    const invoke = setStatus({
      ...base,
      encryptionDecisionPending: [
        { workspaceId: "local-9", workspaceName: "Payments" },
      ],
    });
    renderPage();

    fireEvent.click(
      await screen.findByRole("button", { name: "Sync without encryption" }),
    );
    // The confirm dialog restates the permanence, then runs the action.
    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByText(/can never be encrypted later/),
    ).toBeInTheDocument();
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Sync without encryption" }),
    );

    await waitFor(() =>
      expect(cloudActions(invoke)).toContain("declineWorkspaceEncryption"),
    );
    expect(cloudActions(invoke)).not.toContain("setWorkspaceEncryption");
  });

  it("encrypting calls setWorkspaceEncryption once the typed confirmation matches", async () => {
    const invoke = setStatus({
      ...base,
      encryptionDecisionPending: [
        { workspaceId: "local-9", workspaceName: "Payments" },
      ],
    });
    renderPage();

    fireEvent.click(
      await screen.findByRole("button", { name: "Encrypt this workspace" }),
    );
    const dialog = await screen.findByRole("dialog");
    fillPassphraseFields(dialog, "correct horse battery", "Payments");
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Encrypt this workspace" }),
    );

    await waitFor(() =>
      expect(cloudActions(invoke)).toContain("setWorkspaceEncryption"),
    );
    const call = invoke.mock.calls.find(
      ([, action]) => action === "setWorkspaceEncryption",
    );
    expect(call?.[2]).toEqual({
      workspaceId: "local-9",
      passphrase: "correct horse battery",
    });
  });

  it("cannot be confirmed by Enter or by clicking through without the typed acknowledgement", async () => {
    const invoke = setStatus({
      ...base,
      encryptionDecisionPending: [
        { workspaceId: "local-9", workspaceName: "Payments" },
      ],
    });
    renderPage();

    fireEvent.click(
      await screen.findByRole("button", { name: "Encrypt this workspace" }),
    );
    const dialog = await screen.findByRole("dialog");
    const passphrase = within(dialog).getByLabelText("Passphrase");
    fireEvent.change(passphrase, {
      target: { value: "correct horse battery" },
    });
    fireEvent.change(within(dialog).getByLabelText("Confirm passphrase"), {
      target: { value: "correct horse battery" },
    });

    // Enter from the passphrase field submits the form — and must not commit.
    fireEvent.submit(
      within(dialog).getByLabelText("Passphrase").closest("form")!,
    );
    // Clicking the confirm button must not commit either.
    const confirm = within(dialog).getByRole("button", {
      name: "Encrypt this workspace",
    });
    expect(confirm).toBeDisabled();
    fireEvent.click(confirm);

    await waitFor(() => expect(cloudActions(invoke)).toContain("status"));
    expect(cloudActions(invoke)).not.toContain("setWorkspaceEncryption");

    // A near-miss acknowledgement is still not an acknowledgement.
    fireEvent.change(
      within(dialog).getByLabelText(/Type .Payments. to confirm/),
      { target: { value: "payments" } },
    );
    expect(
      within(dialog).getByRole("button", { name: "Encrypt this workspace" }),
    ).toBeDisabled();
  });
});

describe("CloudSyncPage locked workspaces", () => {
  it("offers unlock and explains the halt instead of showing an error", async () => {
    setStatus({ ...base, bindings: [binding({ encryption: "locked" })] });
    renderPage();

    await waitFor(() => expect(screen.getByText("Locked")).toBeInTheDocument());
    expect(screen.getByText(/Sync is paused/)).toBeInTheDocument();
    expect(
      screen.getByText(/Your local data is untouched/),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Unlock" })).toBeInTheDocument();
    // A halted workspace does not pretend "Sync now" would do anything.
    expect(
      screen.queryByRole("button", { name: "Sync now" }),
    ).not.toBeInTheDocument();
  });

  it("shows an unknown mode as a transient check, not a failure", async () => {
    setStatus({ ...base, bindings: [binding({ encryption: "unknown" })] });
    renderPage();

    await waitFor(() =>
      expect(screen.getByText("Checking…")).toBeInTheDocument(),
    );
    expect(screen.getByText(/resumes on its own/)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Unlock" }),
    ).not.toBeInTheDocument();
  });

  it("badges an unlocked workspace and offers Lock and Change passphrase", async () => {
    setStatus({ ...base, bindings: [binding({ encryption: "unlocked" })] });
    renderPage();

    await waitFor(() =>
      expect(screen.getByText("Encrypted")).toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: "Lock" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Change passphrase" }),
    ).toBeInTheDocument();
  });

  it("a wrong passphrase re-prompts inline and never reads as a sync failure", async () => {
    setStatus(
      { ...base, bindings: [binding({ encryption: "locked" })] },
      {
        unlockWorkspace: {
          code: "conflict",
          message: "That passphrase is not correct.",
          details: { passphraseIncorrect: true },
        },
      },
    );
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Unlock" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Passphrase"), {
      target: { value: "wrong" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Unlock" }));

    // Announced to screen readers, inside the still-open dialog...
    const alert = await within(dialog).findByRole("alert");
    expect(alert).toHaveTextContent(/doesn't match this workspace/);
    expect(alert).toHaveTextContent(
      /Nothing is wrong with your data or with sync/,
    );
    // ...and the field is cleared and refocused for the retry.
    const field = within(dialog).getByLabelText("Passphrase");
    expect(field).toHaveValue("");
    expect(field).toHaveFocus();
  });
});

describe("CloudSyncPage passphrase-change refusals", () => {
  /** Open the change-passphrase dialog on an unlocked workspace and submit it. */
  async function submitChange(failure: {
    readonly code: string;
    readonly message: string;
    readonly details?: unknown;
  }): Promise<HTMLElement> {
    setStatus(
      { ...base, bindings: [binding({ encryption: "unlocked" })] },
      { setWorkspaceEncryption: failure },
    );
    renderPage();

    fireEvent.click(
      await screen.findByRole("button", { name: "Change passphrase" }),
    );
    const dialog = await screen.findByRole("dialog");
    fillPassphraseFields(
      dialog,
      "correct horse battery",
      "Personal",
      "New passphrase",
    );
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Change passphrase" }),
    );
    return dialog;
  }

  // Both messages are read off main's detail flag. The raw envelope message is
  // Electron's "Error invoking remote method" prefix wrapped around whatever
  // main said, so it must never be what the user is shown.
  it("says who can change a passphrase when the server refuses a non-admin", async () => {
    const dialog = await submitChange({
      code: "denied",
      message:
        "Error invoking remote method 'apiweave:invoke': Only a workspace admin can change this workspace's passphrase.",
      details: { passphraseAdminOnly: true },
    });

    const alert = await within(dialog).findByRole("alert");
    expect(alert).toHaveTextContent(
      /Only a workspace admin can change this passphrase/,
    );
    expect(alert).not.toHaveTextContent(/invoking remote method/);
  });

  it("says to unlock first when the key is not held", async () => {
    const dialog = await submitChange({
      code: "conflict",
      message:
        "Error invoking remote method 'apiweave:invoke': This workspace is locked.",
      details: { workspaceLocked: true },
    });

    const alert = await within(dialog).findByRole("alert");
    expect(alert).toHaveTextContent(
      /Unlock it with its current passphrase first/,
    );
    expect(alert).not.toHaveTextContent(/invoking remote method/);
  });
});

/** Fill the three gated fields of a new-passphrase form. */
function fillPassphraseFields(
  scope: HTMLElement,
  passphrase: string,
  workspaceName: string,
  passphraseLabel = "Passphrase",
): void {
  fireEvent.change(within(scope).getByLabelText(passphraseLabel), {
    target: { value: passphrase },
  });
  fireEvent.change(within(scope).getByLabelText("Confirm passphrase"), {
    target: { value: passphrase },
  });
  fireEvent.change(
    within(scope).getByLabelText(
      new RegExp(`Type .${workspaceName}. to confirm`),
    ),
    { target: { value: workspaceName } },
  );
}
