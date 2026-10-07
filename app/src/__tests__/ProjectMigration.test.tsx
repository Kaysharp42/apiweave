import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import API_BASE_URL from "../utils/apiweaveClient";
import { CollectionManager } from "../components/CollectionManager";
import { CollectionExportImport } from "../components/CollectionExportImport";
import type { ScopeContext } from "../types";

type AuthenticatedFetchMock = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

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

const authenticatedFetchMock = vi.hoisted(() =>
  vi.fn<AuthenticatedFetchMock>(),
);

vi.mock("../hooks/useScopeContext", () => ({
  useScopeContext: () => mockScope,
}));

vi.mock("../utils/apiweaveClient", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../utils/apiweaveClient")>()),
  authenticatedFetch: authenticatedFetchMock,
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

describe("project migration UI", () => {
  beforeEach(() => {
    authenticatedFetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("creates a project in the scoped workspace", async () => {
    const user = userEvent.setup();
    const invoke = vi.fn(async (_domain: string, action: string) => ({
      ok: true as const,
      data:
        action === "create"
          ? { projectId: "proj-1", collectionId: "proj-1" }
          : { items: [], total: 0 },
    }));
    vi.stubGlobal("__APIWEAVE_IPC__", {
      invoke,
      onRunProgress: () => () => undefined,
    });

    render(<CollectionManager open={true} onClose={vi.fn()} />);

    await user.click(
      await screen.findByRole("button", { name: /new project/i }),
    );
    await user.type(screen.getByLabelText(/project name/i), "Smoke Project");
    await user.click(screen.getByRole("button", { name: /^create$/i }));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("projects", "create", {
        workspaceId: "ws-1",
        name: "Smoke Project",
        description: "",
        color: "var(--aw-status-info)",
      });
    });
  });

  it("exports a project from scoped route and preserves awecollection extension", async () => {
    const user = userEvent.setup();
    const createdUrls: string[] = [];
    const appendedDownloads: string[] = [];
    const originalAppendChild = document.body.appendChild.bind(document.body);

    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: (blob: Blob) => {
        createdUrls.push(blob.type);
        return "blob:project-export";
      },
      revokeObjectURL: vi.fn(),
    });

    vi.spyOn(document.body, "appendChild").mockImplementation((node: Node) => {
      if (node instanceof HTMLAnchorElement) {
        appendedDownloads.push(node.download);
      }
      return originalAppendChild(node);
    });

    authenticatedFetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          schemaVersion: 2,
          project: { name: "Smoke Project" },
        }),
        { status: 200 },
      ),
    );

    render(
      <CollectionExportImport
        isOpen={true}
        onClose={vi.fn()}
        mode="export"
        projectId="proj-1"
        projectName="Smoke Project"
      />,
    );

    await user.click(
      screen.getByRole("button", { name: /download project bundle/i }),
    );

    await waitFor(() => {
      expect(authenticatedFetchMock).toHaveBeenCalledWith(
        `${API_BASE_URL}/api/workspaces/ws-1/projects/proj-1/export?include_environment=true`,
      );
      expect(appendedDownloads).toContain("Smoke_Project.awecollection");
      expect(createdUrls).toContain("application/json");
    });
  });

  it("validates and imports a project bundle with its workflows", async () => {
    const user = userEvent.setup();
    const bundle = {
      schemaVersion: "2.0",
      type: "awecollection",
      project: { projectId: "source", name: "Imported Project", description: "", color: "#123456" },
      workflows: [{
        workflowId: "workflow-1",
        name: "Imported Workflow",
        description: "",
        nodes: [],
        edges: [],
        variables: {},
        tags: [],
        selectedEnvironmentId: null,
      }],
      environments: [],
      secretReferences: [],
      metadata: {
        exportedAt: "2026-01-01T00:00:00.000Z",
        schemaVersion: "2.0",
        workflowCount: 1,
        environmentCount: 0,
        secretReferenceCount: 0,
      },
    };
    authenticatedFetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/dry-run")) {
        return new Response(JSON.stringify({
          valid: true,
          errors: [],
          warnings: [],
          stats: { workflows: 1, environments: 0, secretReferences: 0, missingSecrets: 0 },
        }), { status: 200 });
      }
      return new Response(JSON.stringify({
        projectId: "imported-project",
        workflowCount: 1,
        environmentCount: 0,
        missingSecrets: [],
        warnings: [],
      }), { status: 200 });
    });

    render(
      <CollectionExportImport
        isOpen={true}
        onClose={vi.fn()}
        mode="import-collection"
      />,
    );

    await user.upload(
      screen.getByLabelText(/project bundle file upload/i),
      new File([JSON.stringify(bundle)], "Imported_Project.awecollection", {
        type: "application/json",
      }),
    );
    await screen.findByText(/file loaded successfully/i);
    expect(screen.getByPlaceholderText(/project name/i)).toHaveValue("Imported Project");
    const importAction = screen.getAllByRole("button", { name: /^import project$/i })[1]!;
    expect(importAction).toBeEnabled();
    expect(screen.getByRole("dialog", { name: /project export import/i })).toHaveClass("z-[100]");

    await user.click(screen.getByRole("button", { name: /^validate$/i }));
    await screen.findByText(/valid project bundle/i);
    await user.click(importAction);

    await waitFor(() => {
      expect(authenticatedFetchMock).toHaveBeenCalledWith(
        `${API_BASE_URL}/api/workspaces/ws-1/projects/import`,
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            bundle,
            createNewProject: true,
            newProjectName: "Imported Project",
            targetProjectId: null,
            environmentMapping: {},
          }),
        }),
      );
    });
  });
});
