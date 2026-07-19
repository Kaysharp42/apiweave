// @vitest-environment jsdom
import "../../../__tests__/setup";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
    graph: { nodes: [{ id: "local-node", type: "start" }], edges: [] },
    variables: { host: "local.example" },
  },
  cloud_payload: {
    name: "Cloud API smoke test",
    graph: { nodes: [{ id: "cloud-node", type: "start" }], edges: [] },
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

  it("renders a side-by-side diff with both records", async () => {
    renderPage("/cloud/conflicts/conflict-1");

    expect(await screen.findByLabelText("Local workflow definition")).toHaveTextContent("Local API smoke test");
    expect(screen.getByLabelText("Cloud workflow definition")).toHaveTextContent("Cloud API smoke test");
    expect(screen.getByLabelText("Local workflow definition")).toHaveTextContent("local-node");
    expect(screen.getByLabelText("Cloud workflow definition")).toHaveTextContent("cloud-node");
  });

  it.each(["local", "cloud"] as const)(
    "choosing %s calls the IPC and navigates",
    async (winner) => {
      const user = userEvent.setup();
      renderPage("/cloud/conflicts/conflict-1");

      await screen.findByLabelText("Local workflow definition");
      await user.click(screen.getByRole("button", { name: `Keep ${winner}` }));
      await user.click(screen.getByRole("button", { name: "Resolve conflict" }));

      await waitFor(() => expect(screen.getByText("conflicts index")).toBeInTheDocument());
      expect(invokeMock).toHaveBeenCalledWith("cloud", "conflict-resolve", {
        conflict_id: "conflict-1",
        winner,
        device_id: "desktop",
      });
      expect(toastSuccess).toHaveBeenCalledWith(`Kept ${winner} copy`);
    },
  );

  it("redacts environment secret references in the diff view", async () => {
    renderPage("/cloud/conflicts/env-conflict");

    expect(await screen.findByLabelText("Local record JSON")).toHaveTextContent("Local env");
    const page = document.body;
    expect(within(page).queryByText(/super-secret-value/)).not.toBeInTheDocument();
    expect(within(page).queryByText(/ciphertext-value/)).not.toBeInTheDocument();
    expect(screen.getByLabelText("Local record JSON")).toHaveTextContent("environment:env-1:API_KEY");
    expect(screen.getByLabelText("Cloud record JSON")).toHaveTextContent("environment:env-1:TOKEN");
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

    await screen.findByLabelText("Local workflow definition");
    await user.click(screen.getByRole("button", { name: "Keep local" }));
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
    expect(screen.getByRole("button", { name: "Keep local" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Keep cloud" })).toBeDisabled();
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

function setIpc(invoke: ReturnType<typeof vi.fn>): void {
  const bridge = { invoke, onRunProgress: vi.fn().mockReturnValue(() => undefined) };
  vi.stubGlobal("__APIWEAVE_IPC__", bridge);
  Object.defineProperty(window, "__APIWEAVE_IPC__", {
    value: bridge,
    configurable: true,
  });
}
