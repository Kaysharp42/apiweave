// @vitest-environment jsdom
import "../../../__tests__/setup";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConflictList } from "../../../components/cloud/ConflictList";
import { PaletteProvider } from "../../../contexts/PaletteContext";
import { ConflictDetailPage } from "../ConflictDetailPage";
import type { Conflict } from "../../../types/cloud";

const toastError = vi.fn();
const toastSuccess = vi.fn();

vi.mock("sonner", () => ({
  toast: {
    error: (message: string) => toastError(message),
    success: (message: string) => toastSuccess(message),
  },
}));

const workflowConflict: Conflict = {
  id: "conflict-1",
  workspace_id: "ws-1",
  kind: "workflow",
  record_id: "workflow-1",
  name: "My Workflow",
  local_rev: 3,
  cloud_rev: 4,
  winner: null,
  created_at: "2026-07-11T12:00:00.000Z",
  local_payload: {
    name: "Local API smoke test",
    nodes: [{ nodeId: "local-node", type: "start", position: { x: 0, y: 0 } }],
    edges: [],
    variables: { host: "local.example" },
  },
  cloud_payload: {
    name: "Cloud API smoke test",
    nodes: [{ nodeId: "cloud-node", type: "start", position: { x: 0, y: 0 } }],
    edges: [],
    variables: { host: "cloud.example" },
  },
};

const environmentConflict: Conflict = {
  ...workflowConflict,
  id: "env-conflict",
  kind: "environment",
  record_id: "env-1",
  local_payload: {
    name: "Local env",
    variables: { baseUrl: "https://local.example" },
    secrets: { API_KEY: "super-secret-value" },
  },
  cloud_payload: {
    name: "Cloud env",
    variables: { baseUrl: "https://cloud.example" },
    secrets: [{ name: "TOKEN", value: "ciphertext-value" }],
  },
};

let invokeMock: ReturnType<typeof vi.fn>;

describe("ConflictDetailPage", () => {
  afterEach(() => cleanup());

  beforeEach(() => {
    toastError.mockReset();
    toastSuccess.mockReset();
    invokeMock = vi.fn(async (_domain: string, action: string, payload: unknown) => {
      if (action === "conflict-get") {
        const conflictId = (payload as { conflict_id: string }).conflict_id;
        return { ok: true, data: conflictId === "env-conflict" ? environmentConflict : workflowConflict };
      }
      if (action === "conflict-resolve") return { ok: true, data: workflowConflict };
      return { ok: true, data: [] };
    });
    setIpc(invokeMock);
  });

  it("renders an IntelliJ-style Cloud, result, and Local merge workspace", async () => {
    renderPage("/cloud/conflicts/conflict-1");

    await screen.findByRole("button", { name: "Keep Local copy" });
    expect(screen.getByTestId("conflict-merge-workspace")).toBeInTheDocument();
    expect(screen.getAllByText("Cloud copy").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Merge result").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Local copy").length).toBeGreaterThan(0);
    expect(screen.getByText('Node "local-node" added')).toBeInTheDocument();
    expect(screen.getByText('Node "cloud-node" removed')).toBeInTheDocument();
    expect(screen.getByText("Name")).toBeInTheDocument();
    expect(screen.getByText("Cloud API smoke test")).toBeInTheDocument();
    expect(screen.getByText("Local API smoke test")).toBeInTheDocument();
  });

  it("shows the cloud-side author when the server attributed it", async () => {
    const attributed = {
      ...workflowConflict,
      cloud_writer: { userId: "u2", deviceId: "d2", name: "Grace", deviceLabel: "Cloud Desktop" },
    };
    invokeMock.mockImplementation(async (_domain: string, action: string) => {
      if (action === "conflict-get") return { ok: true, data: attributed };
      return { ok: true, data: [] };
    });
    renderPage("/cloud/conflicts/conflict-1");

    await screen.findByRole("button", { name: "Keep Local copy" });
    expect(screen.getByText("Incoming · revision 4 · Grace · Cloud Desktop")).toBeInTheDocument();
  });

  it("falls back to unknown author when the cloud writer is absent", async () => {
    renderPage("/cloud/conflicts/conflict-1");
    await screen.findByRole("button", { name: "Keep Local copy" });
    expect(screen.getByText("Incoming · revision 4 · an unknown author")).toBeInTheDocument();
  });

  it("keeps the raw JSON available behind the technical-detail toggle", async () => {
    const user = userEvent.setup();
    renderPage("/cloud/conflicts/conflict-1");

    await screen.findByRole("button", { name: "Keep Local copy" });
    await user.click(screen.getByText("Technical detail (raw JSON)"));
    expect(await screen.findByLabelText("Local record JSON")).toHaveTextContent("Local API smoke test");
    expect(screen.getByLabelText("Cloud record JSON")).toHaveTextContent("Cloud API smoke test");
  });

  it.each(["local", "cloud"] as const)(
    "choosing %s calls the IPC and navigates",
    async (winner) => {
      const user = userEvent.setup();
      renderPage("/cloud/conflicts/conflict-1");

      await screen.findByRole("button", { name: "Keep Local copy" });
      await user.click(screen.getByRole("button", { name: `Keep ${winner === "local" ? "Local" : "Cloud"} copy` }));
      await user.click(screen.getByRole("button", { name: "Resolve conflict" }));

      await waitFor(() => expect(screen.getByText("conflicts index")).toBeInTheDocument());
      expect(invokeMock).toHaveBeenCalledWith("cloud", "conflict-resolve", {
        conflict_id: "conflict-1",
        winner,
        device_id: "desktop",
        defer_push: true,
      });
      expect(toastSuccess).toHaveBeenCalledWith(`Kept ${winner} copy`);
    },
  );

  it("offers per-field picking for residual paths and forwards the picks on merge", async () => {
    const fieldPickConflict: Conflict = { ...workflowConflict, merge_residual_paths: ["name"] };
    invokeMock.mockImplementation(async (_domain: string, action: string) => {
      if (action === "conflict-get") return { ok: true, data: fieldPickConflict };
      if (action === "conflict-resolve") return { ok: true, data: fieldPickConflict };
      return { ok: true, data: [] };
    });
    const user = userEvent.setup();
    renderPage("/cloud/conflicts/conflict-1");

    await screen.findByRole("button", { name: "Keep Local copy" });
    expect(screen.getByText("1 unresolved")).toBeInTheDocument();

    // The merge is blocked until every residual path has a pick.
    const mergeButton = screen.getByRole("button", { name: "Apply merge to workspace" });
    expect(mergeButton).toBeDisabled();

    // Accept the Local side into the middle result pane.
    await user.click(screen.getByRole("button", { name: "Accept Local for Name" }));
    expect(screen.getByText("Accepted local")).toBeInTheDocument();
    expect(mergeButton).toBeEnabled();

    await user.click(mergeButton);
    await user.click(screen.getByRole("button", { name: "Apply to workspace" }));

    await waitFor(() => expect(screen.getByText("conflicts index")).toBeInTheDocument());
    expect(invokeMock).toHaveBeenCalledWith("cloud", "conflict-resolve", {
      conflict_id: "conflict-1",
      winner: "merged",
      device_id: "desktop",
      defer_push: true,
      resolutions: [{ path: "name", side: "local" }],
    });
    expect(toastSuccess).toHaveBeenCalledWith("Merged both copies");
  });

  // An end-to-end encrypted workspace never gets a server-side 3-way merge: the
  // server cannot read the payloads, so auto_mergeable is always false and
  // merge_residual_paths always empty. That must read as "choose one whole
  // copy", never as a failure or a blocked control.
  it("offers a whole-record choice, not an error, when no auto-merge is available", async () => {
    const encryptedConflict: Conflict = {
      ...workflowConflict,
      auto_mergeable: false,
      merge_residual_paths: [],
    };
    invokeMock.mockImplementation(async (_domain: string, action: string) => {
      if (action === "conflict-get") return { ok: true, data: encryptedConflict };
      return { ok: true, data: [] };
    });
    renderPage("/cloud/conflicts/conflict-1");

    await screen.findByRole("button", { name: "Keep Local copy" });
    expect(screen.getByText("whole-record choice")).toBeInTheDocument();
    expect(screen.getByText("Choose one complete copy")).toBeInTheDocument();
    // No merge is offered at all — not a disabled one, and no warning banner.
    expect(screen.queryByRole("button", { name: "Apply merge to workspace" })).not.toBeInTheDocument();
    expect(screen.queryByText("Merge unavailable for this conflict")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Keep Local copy" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Keep Cloud copy" })).toBeEnabled();
  });

  it("blocks the merge and warns when a residual path has no matching diff entry", async () => {
    const mismatchConflict: Conflict = { ...workflowConflict, merge_residual_paths: ["nonexistent.deep.path"] };
    invokeMock.mockImplementation(async (_domain: string, action: string) => {
      if (action === "conflict-get") return { ok: true, data: mismatchConflict };
      return { ok: true, data: [] };
    });
    renderPage("/cloud/conflicts/conflict-1");

    await screen.findByRole("button", { name: "Keep Local copy" });
    // The drift warning surfaces and the result picker does not.
    expect(screen.getByText("Merge unavailable for this conflict")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Accept Local for/ })).not.toBeInTheDocument();

    // The merge is blocked; the whole-record fallbacks remain enabled.
    expect(screen.getByRole("button", { name: "Apply merge to workspace" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Keep Local copy" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Keep Cloud copy" })).toBeEnabled();
  });

  it("removes the resolved detail page from back navigation history", async () => {
    invokeMock.mockImplementation(async (_domain: string, action: string) => {
      if (action === "conflict-list") return { ok: true, data: [workflowConflict] };
      if (action === "conflict-get") return { ok: true, data: workflowConflict };
      if (action === "conflict-resolve") return { ok: true, data: workflowConflict };
      return { ok: true, data: [] };
    });
    const user = userEvent.setup();
    renderHistoryPage();

    await user.click(await screen.findByRole("button", { name: "Open" }));
    await screen.findByRole("button", { name: "Keep Local copy" });
    await user.click(screen.getByRole("button", { name: "Keep Local copy" }));
    await user.click(screen.getByRole("button", { name: "Resolve conflict" }));

    await user.click(await screen.findByRole("button", { name: "Back to app" }));
    expect(await screen.findByText("app index")).toBeInTheDocument();
    expect(screen.queryByText("Resolve conflict")).not.toBeInTheDocument();
  });

  it("redacts environment secret references in the diff view", async () => {
    renderPage("/cloud/conflicts/env-conflict");

    await screen.findByRole("button", { name: "Keep Local copy" });
    const page = document.body;
    expect(within(page).queryByText(/super-secret-value/)).not.toBeInTheDocument();
    expect(within(page).queryByText(/ciphertext-value/)).not.toBeInTheDocument();
    expect(page).toHaveTextContent("environment:env-1:API_KEY");
    expect(page).toHaveTextContent("environment:env-1:TOKEN");
  });

  it("errors on double-submit for the same conflict as a no-op toast", async () => {
    invokeMock.mockImplementation(async (_domain: string, action: string) => {
      if (action === "conflict-get") return { ok: true, data: workflowConflict };
      if (action === "conflict-resolve") {
        return { ok: false, error: { code: "conflict", message: "Conflict already resolved" } };
      }
      return { ok: true, data: [] };
    });
    const user = userEvent.setup();
    renderPage("/cloud/conflicts/conflict-1");

    await screen.findByRole("button", { name: "Keep Local copy" });
    await user.click(screen.getByRole("button", { name: "Keep Local copy" }));
    await user.click(screen.getByRole("button", { name: "Resolve conflict" }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Conflict already resolved"));
    expect(screen.queryByText("conflicts index")).not.toBeInTheDocument();
  });

  it("errors when stale conflicts are already resolved", async () => {
    invokeMock.mockImplementation(async (_domain: string, action: string) => {
      if (action === "conflict-get") {
        return { ok: true, data: { ...workflowConflict, winner: "local" } };
      }
      return { ok: true, data: [] };
    });
    renderPage("/cloud/conflicts/conflict-1");

    expect(await screen.findByText("Conflict already resolved")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Keep Local copy" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Keep Cloud copy" })).toBeDisabled();
  });
});

function renderPage(initialEntry: string): void {
  render(
    <PaletteProvider>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path="/cloud/conflicts/:conflictId" element={<ConflictDetailPage />} />
          <Route path="/cloud/conflicts" element={<div>conflicts index</div>} />
        </Routes>
      </MemoryRouter>
    </PaletteProvider>,
  );
}

function renderHistoryPage(): void {
  render(
    <PaletteProvider>
      <MemoryRouter initialEntries={["/app", "/cloud/conflicts"]} initialIndex={1}>
        <Routes>
          <Route path="/app" element={<div>app index</div>} />
          <Route path="/cloud/conflicts/:conflictId" element={<ConflictDetailPage />} />
          <Route path="/cloud/conflicts" element={<ConflictIndex />} />
        </Routes>
      </MemoryRouter>
    </PaletteProvider>,
  );
}

function ConflictIndex() {
  const navigate = useNavigate();
  return (
    <div>
      <button type="button" onClick={() => navigate(-1)}>Back to app</button>
      <ConflictList />
    </div>
  );
}

function setIpc(invoke: ReturnType<typeof vi.fn>): void {
  const bridge = { invoke, onRunProgress: vi.fn().mockReturnValue(() => undefined) };
  vi.stubGlobal("__APIWEAVE_IPC__", bridge);
  Object.defineProperty(window, "__APIWEAVE_IPC__", {
    value: bridge,
    configurable: true,
  });
}
