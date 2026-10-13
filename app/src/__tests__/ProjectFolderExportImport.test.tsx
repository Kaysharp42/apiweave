import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CollectionExportImport } from "../components/CollectionExportImport";
import type { ProjectFolderBridge } from "@shared/types/ProjectFolderBridge";
import type { ScopeContext } from "../types";

type TestIpcBridge = NonNullable<Window["__APIWEAVE_IPC__"]>;

const mockScope = vi.hoisted(
  (): ScopeContext => ({
    workspaceId: "ws-1",
    workspaceSlug: "personal",
    orgId: null,
    orgSlug: null,
    userId: "user-1",
    isReady: true,
  }),
);

vi.mock("../hooks/useScopeContext", () => ({
  useScopeContext: () => mockScope,
}));

function installBridges(): ProjectFolderBridge {
  vi.stubGlobal("__APIWEAVE_IPC__", {
    invoke: vi.fn<TestIpcBridge["invoke"]>(async () => ({ ok: true, data: { items: [], total: 0 } })),
    onRunProgress: () => () => undefined,
  });
  const bridge: ProjectFolderBridge = {
    exportProject: vi.fn(async () => ({
      folder: "/repo/apiweave",
      workflowCount: 2,
      environmentCount: 1,
      written: ["project.json", "workflows/login.json"],
      removed: ["workflows/old.json"],
    })),
    importProject: vi.fn(async () => ({
      folder: "/repo/apiweave",
      projectId: "proj-1",
      created: 1,
      updated: 2,
      unchanged: 3,
      detached: 0,
      environmentCount: 1,
      missingSecrets: [],
      warnings: [],
    })),
  };
  vi.stubGlobal("__APIWEAVE_PROJECT_FOLDERS__", bridge);
  return bridge;
}

describe("project folder export and import", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("exports the project to a folder the user picks in main and reports the files", async () => {
    const user = userEvent.setup();
    const bridge = installBridges();
    render(
      <CollectionExportImport isOpen onClose={vi.fn()} projectId="proj-1" projectName="Shop API" mode="export" />,
    );

    await user.click(screen.getByRole("button", { name: /export to folder/i }));

    await waitFor(() => {
      expect(bridge.exportProject).toHaveBeenCalledWith({ workspaceId: "ws-1", projectId: "proj-1" });
    });
    expect(await screen.findByText(/2 file\(s\) written, 1 removed/)).toBeInTheDocument();
  });

  it("imports a folder and reports what changed", async () => {
    const user = userEvent.setup();
    const bridge = installBridges();
    const onImportSuccess = vi.fn();
    render(
      <CollectionExportImport isOpen onClose={vi.fn()} mode="import-collection" onImportSuccess={onImportSuccess} />,
    );

    await user.click(screen.getByRole("button", { name: /import from folder/i }));

    await waitFor(() => {
      expect(bridge.importProject).toHaveBeenCalledWith({ workspaceId: "ws-1" });
    });
    expect(await screen.findByText(/1 created, 2 updated, 3 unchanged\./)).toBeInTheDocument();
    expect(onImportSuccess).toHaveBeenCalledWith("proj-1");
  });
});
