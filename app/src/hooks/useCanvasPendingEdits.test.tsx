import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Node } from "@xyflow/react";
import type { Workflow } from "@shared/types/Workflow";
import { workflowToCanvas } from "../adapters/workflowCanvas";
import useTabStore from "../stores/TabStore";
import usePendingEditsStore, {
  confirmCloseAll,
  confirmCloseTabs,
} from "../stores/PendingEditsStore";
import type { WorkflowCanvasNodeData } from "../types/WorkflowCanvasNodeData";
import useCanvasPendingEdits from "./useCanvasPendingEdits";
import { toast } from "sonner";
import { useHydration } from "./useHydration";

const fetchMock = vi.hoisted(() => vi.fn());

vi.mock("../utils/apiweaveClient", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../utils/apiweaveClient")>()),
  authenticatedFetch: fetchMock,
}));

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

function makeWorkflow(overrides: Partial<Workflow> = {}): Workflow {
  return {
    workflowId: "wf1",
    workspaceId: "ws1",
    name: "Orders",
    nodes: [
      {
        nodeId: "n1",
        type: "http-request",
        label: "Saved label",
        position: { x: 0, y: 0 },
        config: {},
      },
    ],
    edges: [],
    variables: {},
    selectedEnvironmentId: null,
    tags: [],
    nodeTemplates: [],
    rev: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  } as Workflow;
}

const tab = () => useTabStore.getState().tabs.find((t) => t.id === "wf1");

/** Mounts the hook for wf1 over a canvas showing `saved` with one edit made. */
function mountEditedCanvas(saved: Workflow, edit: boolean) {
  const canvas = workflowToCanvas(saved);
  const nodes = edit
    ? canvas.nodes.map((n) => ({
        ...n,
        data: { ...n.data, label: "Edited label" },
      }))
    : canvas.nodes;
  return renderHook(() =>
    useCanvasPendingEdits({
      workflowId: "wf1",
      isHydrated: true,
      flush: () => Promise.resolve(),
      save: () => Promise.resolve(),
      readCanvas: () => ({
        nodes,
        edges: canvas.edges,
        variables: edit ? { token: "abc" } : {},
      }),
    }),
  );
}

describe("useCanvasPendingEdits", () => {
  beforeEach(() => {
    useTabStore.setState({ tabs: [], activeTabIdByWorkspace: {} });
    useTabStore.getState().openTab(makeWorkflow());
    fetchMock.mockReset();
  });
  afterEach(() => usePendingEditsStore.getState().answer("cancel"));

  it("keeps unsaved edits across a tab switch and restores them on return", () => {
    // Auto-save off: nothing flushes, so the unmount is the only chance.
    mountEditedCanvas(makeWorkflow(), true).unmount();

    expect(tab()?.isDirty).toBe(true);
    const draft = tab()?.draft;
    expect(draft?.nodes[0]?.label).toBe("Edited label");
    expect(draft?.variables).toEqual({ token: "abc" });

    // Back on the tab: the canvas hydrates from the draft, not the saved row.
    const state: { nodes: Node<WorkflowCanvasNodeData>[] } = { nodes: [] };
    renderHook(() =>
      useHydration({
        workflow: tab()?.draft ?? tab()?.workflow,
        setNodes: (next) => {
          state.nodes = typeof next === "function" ? next(state.nodes) : next;
        },
        setEdges: () => {},
      }),
    );
    expect(state.nodes[0]?.data.label).toBe("Edited label");
  });

  it("leaves no draft when the canvas matched the saved workflow", () => {
    useTabStore.getState().stashDraft("wf1", makeWorkflow({ name: "stale" }));
    mountEditedCanvas(makeWorkflow(), false).unmount();
    expect(tab()?.draft).toBeUndefined();
    expect(tab()?.isDirty).toBe(false);
  });

  it("asks about a dirty inactive tab on quit, and Save writes its draft", async () => {
    mountEditedCanvas(makeWorkflow(), true).unmount();
    const echoed = { ...tab()!.draft!, rev: 2 };
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(echoed), { status: 200 }),
    );

    const quitting = confirmCloseAll();
    await vi.waitFor(() =>
      expect(usePendingEditsStore.getState().promptFor).toBe("Orders"),
    );
    usePendingEditsStore.getState().answer("save");

    expect(await quitting).toBe(true);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe("PATCH");
    const body = JSON.parse(init.body as string) as Workflow & {
      expectedRevision?: number;
    };
    expect(body.nodes[0]?.label).toBe("Edited label");
    // Saved against the revision the draft was cut from.
    expect(body.expectedRevision).toBe(1);
    expect(tab()?.draft).toBeUndefined();
    expect(tab()?.workflow?.rev).toBe(2);
  });

  it("keeps the draft when the workflow changed elsewhere since it was cut", async () => {
    mountEditedCanvas(makeWorkflow(), true).unmount();
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ code: "conflict", detail: "workflow revision is stale" }),
        { status: 409 },
      ),
    );

    const closing = confirmCloseTabs(["wf1"]);
    await vi.waitFor(() =>
      expect(usePendingEditsStore.getState().promptFor).toBe("Orders"),
    );
    usePendingEditsStore.getState().answer("save");

    expect(await closing).toBe(false);
    expect(tab()?.draft?.nodes[0]?.label).toBe("Edited label");
    expect(vi.mocked(toast.error)).toHaveBeenCalledWith(
      expect.stringContaining("changed elsewhere"),
      expect.anything(),
    );
  });

  it("keeps the tab open when its draft's save fails", async () => {
    mountEditedCanvas(makeWorkflow(), true).unmount();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ detail: "nope" }), { status: 400 }),
    );

    const closing = confirmCloseTabs(["wf1"]);
    await vi.waitFor(() =>
      expect(usePendingEditsStore.getState().promptFor).toBe("Orders"),
    );
    usePendingEditsStore.getState().answer("save");

    expect(await closing).toBe(false);
    expect(tab()?.draft).toBeDefined();
  });

  it("Cancel on a dirty inactive tab stops the quit", async () => {
    mountEditedCanvas(makeWorkflow(), true).unmount();
    const quitting = confirmCloseAll();
    await vi.waitFor(() =>
      expect(usePendingEditsStore.getState().promptFor).toBe("Orders"),
    );
    usePendingEditsStore.getState().answer("cancel");
    expect(await quitting).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("stashes nothing for a tab that was closed", () => {
    const hook = mountEditedCanvas(makeWorkflow(), true);
    useTabStore.getState().closeTab("wf1");
    hook.unmount();
    expect(useTabStore.getState().tabs).toHaveLength(0);
  });
});
