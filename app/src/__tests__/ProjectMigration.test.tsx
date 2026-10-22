import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CollectionManager } from "../components/CollectionManager";
import { CollectionExportImport } from "../components/CollectionExportImport";
import type { ScopeContext } from "../types";

type TestIpcBridge = NonNullable<Window["__APIWEAVE_IPC__"]>;

/** Stubs the preload bridge; `respond` answers each `domain.action` call. */
function installBridge(
  respond: (key: string, payload: unknown) => unknown,
): ReturnType<typeof vi.fn<TestIpcBridge["invoke"]>> {
  const invoke = vi.fn<TestIpcBridge["invoke"]>(
    async (domain, action, payload) => ({
      ok: true,
      data: respond(`${domain}.${action}`, payload),
    }),
  );
  vi.stubGlobal("__APIWEAVE_IPC__", {
    invoke,
    onRunProgress: () => () => undefined,
  });
  return invoke;
}

const mockScope = vi.hoisted(
  (): ScopeContext => ({
    workspaceId: "ws-1",
    workspaceSlug: "personal",
    orgId: null,
    orgSlug: null,
    isReady: true,
  }),
);

vi.mock("../hooks/useScopeContext", () => ({
  useScopeContext: () => mockScope,
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

describe("project migration UI", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("creates a project in the scoped workspace", async () => {
    const user = userEvent.setup();
    const invoke = installBridge((key) =>
      key === "projects.create"
        ? { projectId: "proj-1", collectionId: "proj-1" }
        : { items: [], total: 0 },
    );

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

  it("exports a project and preserves the awecollection extension", async () => {
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

    const invoke = installBridge((key) =>
      key === "projects.export"
        ? { schemaVersion: 2, project: { name: "Smoke Project" } }
        : { items: [], total: 0 },
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
      expect(invoke).toHaveBeenCalledWith("projects", "export", {
        workspaceId: "ws-1",
        projectId: "proj-1",
        includeEnvironments: true,
      });
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
    const invoke = installBridge((key) => {
      if (key === "projects.dryRun") {
        return {
          valid: true,
          errors: [],
          warnings: [],
          stats: { schemaVersion: "2.0", workflows: 1, environments: 0, secretReferences: 0, missingSecrets: 0 },
        };
      }
      if (key === "projects.import") {
        return {
          projectId: "imported-project",
          workflowCount: 1,
          environmentCount: 0,
          missingSecrets: [],
          warnings: [],
        };
      }
      return { items: [], total: 0 };
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
    const importAction = screen.getByRole("button", { name: /^import project$/i });
    expect(importAction).toBeEnabled();
    expect(screen.getByRole("dialog", { name: "Import Project" })).toHaveAttribute("aria-modal", "true");
    expect(screen.getByRole("tab", { name: /import project/i })).toHaveAttribute("aria-selected", "true");

    await user.click(screen.getByRole("button", { name: /^validate$/i }));
    await screen.findByText(/valid project bundle/i);
    await user.click(importAction);

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("projects", "import", {
        workspaceId: "ws-1",
        bundle,
        projectName: "Imported Project",
      });
    });
  });

  it("imports a workflow bundle into a project in one call", async () => {
    const user = userEvent.setup();
    const invoke = installBridge((key) =>
      key === "workflows.import"
        ? { workflowId: "wf-new", name: "WF", nodeCount: 0, edgeCount: 0, secretReferences: [], warnings: [] }
        : { items: [], total: 0 },
    );
    const bundle = { workflow: { name: "WF", nodes: [], edges: [], variables: {} } };

    render(
      <CollectionExportImport
        isOpen={true}
        onClose={vi.fn()}
        mode="import-workflows"
        projectId="proj-1"
      />,
    );

    await user.upload(
      screen.getByLabelText(/project workflow or har file upload/i),
      new File([JSON.stringify(bundle)], "wf.json", { type: "application/json" }),
    );
    await screen.findByText(/file loaded successfully/i);
    await user.click(screen.getByRole("button", { name: /import to project/i }));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("workflows", "import", {
        workspaceId: "ws-1",
        bundle,
        collectionId: "proj-1",
      });
    });
    expect(invoke.mock.calls.some(([, action]) => action === "addWorkflow")).toBe(false);
  });

  it("imports an OpenAPI file into a project as a workflow with node templates", async () => {
    const user = userEvent.setup();
    const parsedNode = {
      nodeId: "tpl-1",
      type: "http-request",
      label: "List pets",
      position: { x: 0, y: 0 },
      config: { method: "GET", url: "/pets" },
    };
    const invoke = installBridge((key) => {
      if (key === "workflows.importOpenapi") return { nodes: [parsedNode] };
      if (key === "workflows.create") return { workflowId: "wf-new" };
      return { items: [], total: 0 };
    });

    render(
      <CollectionExportImport
        isOpen={true}
        onClose={vi.fn()}
        mode="import-openapi"
        projectId="proj-1"
      />,
    );

    await user.upload(
      screen.getByLabelText(/project openapi file upload/i),
      new File([JSON.stringify({ openapi: "3.0.0", paths: {} })], "spec.json", {
        type: "application/json",
      }),
    );
    await screen.findByText(/file loaded successfully/i);
    await user.click(screen.getByRole("button", { name: /import to project/i }));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith(
        "workflows",
        "create",
        expect.objectContaining({
          workspaceId: "ws-1",
          collectionId: "proj-1",
          nodeTemplates: [parsedNode],
        }),
      );
    });
    const create = invoke.mock.calls.find(([, action]) => action === "create");
    const nodes = (create?.[2] as { nodes: Record<string, unknown>[] }).nodes;
    // The workflow node schema is strict: a node carries `config`, never `data`.
    expect(nodes.every((node) => "config" in node && !("data" in node))).toBe(
      true,
    );
  });
});
