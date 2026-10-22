import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { Sidebar } from "../components/layout/Sidebar";
import useSidebarStore from "../stores/SidebarStore";
import useTabStore from "../stores/TabStore";
import type {
  ConfirmDialogProps,
  PromptDialogProps,
  ScopeContext,
  Workflow,
  WorkflowListProps,
} from "../types";
type TestIpcBridge = NonNullable<Window["__APIWEAVE_IPC__"]>;

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  useScopeContext: vi.fn<() => ScopeContext>(),
}));

vi.mock("react-router-dom", () => ({
  useNavigate: () => mocks.navigate,
}));

vi.mock("sonner", () => ({
  toast: {
    error: mocks.toastError,
    success: mocks.toastSuccess,
  },
}));

vi.mock("../hooks/useScopeContext", () => ({
  useScopeContext: () => mocks.useScopeContext(),
}));

vi.mock("../components/layout/SidebarHeader", () => ({
  SidebarHeader: ({ onCreateNew }: { onCreateNew: () => void }) => (
    <button type="button" onClick={onCreateNew}>
      new workflow
    </button>
  ),
}));

vi.mock("../components/layout/sidebar/WorkflowList", () => ({
  WorkflowList: (props: WorkflowListProps) => {
    const workflow: Workflow = {
      workflowId: "wf-open",
      workspaceId: "ws-personal",
      name: "Open Me",
      nodes: [],
      edges: [],
      variables: {},
      tags: [],
      nodeTemplates: [],
      rev: 0,
      createdAt: "2026-06-18T00:00:00Z",
      updatedAt: "2026-06-18T00:00:00Z",
    };

    return (
      <div>
        <button type="button" onClick={props.onCreateWorkflow}>
          show create workflow
        </button>
        <button type="button" onClick={() => props.onWorkflowClick(workflow)}>
          open workflow
        </button>
        <button
          type="button"
          onClick={() => props.onDeleteWorkflow("wf-delete", "Delete Me")}
        >
          queue delete workflow
        </button>
      </div>
    );
  },
}));

vi.mock("../components/layout/sidebar/ProjectList", () => ({
  ProjectList: () => null,
}));

vi.mock("../components/layout/sidebar/SettingsContent", () => ({
  SettingsContent: () => null,
}));

vi.mock("../components/CollectionManager", () => ({ default: () => null }));
vi.mock("../components/MCPManager", () => ({ default: () => null }));
vi.mock("../components/WorkflowExportImport", () => ({ default: () => null }));
vi.mock("../components/CollectionExportImport", () => ({
  default: () => null,
}));

vi.mock("../components/molecules/PromptDialog", () => ({
  PromptDialog: ({ open, onSubmit }: PromptDialogProps) =>
    open ? (
      <button type="button" onClick={() => onSubmit("Scoped Smoke")}>
        submit workflow prompt
      </button>
    ) : null,
}));

vi.mock("../components/molecules/ConfirmDialog", () => ({
  ConfirmDialog: ({ open, onConfirm, title }: ConfirmDialogProps) =>
    open ? (
      <button type="button" onClick={onConfirm}>
        confirm {title}
      </button>
    ) : null,
}));

function makeWorkflow(workflowId: string, name: string): Workflow {
  return {
    workflowId,
    workspaceId: "ws-personal",
    name,
    nodes: [],
    edges: [],
    variables: {},
    tags: [],
    nodeTemplates: [],
    rev: 0,
    createdAt: "2026-06-18T00:00:00Z",
    updatedAt: "2026-06-18T00:00:00Z",
  };
}

function scopeContext(
  workspaceId: string | null,
  isReady: boolean,
): ScopeContext {
  return {
    workspaceId,
    workspaceSlug: workspaceId ? "personal" : null,
    orgId: null,
    orgSlug: null,
    isReady,
  };
}

function resetStores(): void {
  useSidebarStore.setState({
    workflows: [],
    collections: [],
    projects: [],
    isRefreshing: false,
    searchQuery: "",
    workflowVersion: 0,
    collectionVersion: 0,
    projectVersion: 0,
    activeWorkspaceId: null,
  });
  useTabStore.setState({ tabs: [], activeTabIdByWorkspace: {} });
}

function installBridge(): ReturnType<typeof vi.fn<TestIpcBridge["invoke"]>> {
  const workflow = makeWorkflow("wf-created", "Scoped Smoke");
  const invoke = vi.fn<TestIpcBridge["invoke"]>(async (domain, action) => {
    const key = `${domain}.${action}`;
    if (key === "workflows.get")
      return { ok: true, data: makeWorkflow("wf-open", "Open Me") };
    if (key === "workflows.create") return { ok: true, data: workflow };
    if (key === "workflows.list")
      return { ok: true, data: { items: [workflow], total: 1 } };
    if (key === "workflows.delete") return { ok: true, data: null };
    return { ok: true, data: { items: [], total: 0 } };
  });
  vi.stubGlobal("__APIWEAVE_IPC__", {
    invoke,
    onRunProgress: () => () => undefined,
  });
  return invoke;
}

describe("sidebar workflow IPC calls", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStores();
    mocks.useScopeContext.mockReturnValue(scopeContext("ws-1", true));
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("lists the active workspace's workflows", async () => {
    const invoke = installBridge();
    useSidebarStore.setState({ activeWorkspaceId: "ws-1" });

    await useSidebarStore.getState().fetchWorkflows();

    expect(invoke).toHaveBeenCalledWith("workflows", "list", {
      workspaceId: "ws-1",
      includeAttached: false,
    });
    expect(useSidebarStore.getState().workflows.map((w) => w.workflowId)).toEqual([
      "wf-created",
    ]);
  });

  it("does not create workflows when workspace context is missing", async () => {
    mocks.useScopeContext.mockReturnValue(scopeContext(null, false));
    const invoke = installBridge();

    await useSidebarStore.getState().fetchWorkflows();

    render(<Sidebar />);
    fireEvent.click(screen.getByText("show create workflow"));
    fireEvent.click(screen.getByText("submit workflow prompt"));

    expect(invoke).not.toHaveBeenCalledWith(
      "workflows",
      "create",
      expect.anything(),
    );
    expect(mocks.toastError).toHaveBeenCalledWith(
      "Workspace context is still loading. Please retry once a workspace is selected.",
    );
    expect(mocks.navigate).not.toHaveBeenCalledWith("/");
  });

  it("creates and opens workflows in the scoped workspace", async () => {
    const invoke = installBridge();

    render(<Sidebar />);
    fireEvent.click(screen.getByText("show create workflow"));
    fireEvent.click(screen.getByText("submit workflow prompt"));
    fireEvent.click(screen.getByText("open workflow"));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith(
        "workflows",
        "create",
        expect.objectContaining({ workspaceId: "ws-1", name: "Scoped Smoke" }),
      );
      expect(invoke).toHaveBeenCalledWith("workflows", "get", {
        workspaceId: "ws-1",
        workflowId: "wf-open",
      });
    });
  });

  it("deletes workflows in the scoped workspace", async () => {
    const invoke = installBridge();

    render(<Sidebar />);
    fireEvent.click(screen.getByText("queue delete workflow"));
    fireEvent.click(await screen.findByText(/^confirm/));

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("workflows", "delete", {
        workspaceId: "ws-1",
        workflowId: "wf-delete",
      }),
    );
    expect(mocks.toastSuccess).toHaveBeenCalledWith(
      "Workflow deleted permanently",
    );
  });
});
