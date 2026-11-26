import { act, render } from "@testing-library/react";
import { useCallback, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Workflow } from "@shared/types/Workflow";
import type { WorkflowChangedEvent } from "@shared/types/WorkflowChangedEvent";
import { workflowToCanvas } from "../adapters/workflowCanvas";
import { PaletteProvider } from "../contexts/PaletteContext";
import type { CanvasWorkflowState } from "../types/CanvasWorkflowState";
import { WorkflowProvider, useWorkflow } from "../contexts/WorkflowContext";
import useAutoSave from "./useAutoSave";
import useExtractorRegistration from "./useExtractorRegistration";
import { useNodeBranchCounts } from "./useNodeBranchCounts";
import useWorkflowLiveUpdates from "./useWorkflowLiveUpdates";

const onWorkflowChangedMock = vi.hoisted(() => vi.fn());

vi.mock("../utils/apiweaveClient", () => ({
  onWorkflowChanged: onWorkflowChangedMock,
  apiweave: { projects: { list: vi.fn() } },
}));

vi.mock("sonner", () => ({ toast: { warning: vi.fn() } }));

type Listener = (event: WorkflowChangedEvent) => void;

function makeWorkflow(rev: number, extractors: Record<string, string>): Workflow {
  return {
    workflowId: "wf1",
    workspaceId: "ws1",
    name: "Workflow",
    nodes: [
      { nodeId: "start", type: "start", position: { x: 0, y: 0 }, config: {} },
      {
        nodeId: "login",
        type: "http-request",
        position: { x: 200, y: 0 },
        config: { method: "POST", url: "https://example.test/login", extractors },
      },
    ],
    edges: [{ edgeId: "e1", source: "start", target: "login" }],
    // Seeded by hand; extractor names need no entry.
    variables: { region: "north" },
    selectedEnvironmentId: null,
    tags: [],
    nodeTemplates: [],
    rev,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: `2026-01-01T00:00:0${rev}.000Z`,
  } as Workflow;
}

/**
 * The canvas's persistence wiring without its rendering: the same hooks, fed
 * the same way `WorkflowCanvas` feeds them, so a derived value that leaks into
 * a save shows up as a `saveWorkflow` call.
 */
function CanvasWiring({
  initial,
  save,
}: {
  initial: Workflow;
  save: (silent: boolean) => Promise<unknown>;
}) {
  const { variables, registerExtractors, updateVariables } = useWorkflow();

  const [workflow, setWorkflow] = useState(initial);
  const [graph, setGraph] = useState(() => workflowToCanvas(initial));
  const [hydration, setHydration] = useState(0);
  const setNodes = useCallback<
    React.Dispatch<React.SetStateAction<CanvasWorkflowState["nodes"]>>
  >(
    (next) =>
      setGraph((current) => {
        const nodes = typeof next === "function" ? next(current.nodes) : next;
        return nodes === current.nodes ? current : { ...current, nodes };
      }),
    [],
  );

  useExtractorRegistration(graph.nodes, registerExtractors);
  // Writes branch counts — display state — onto every node's `data`.
  useNodeBranchCounts({ nodes: graph.nodes, edges: graph.edges, setNodes });
  useWorkflowLiveUpdates({
    workspaceId: "ws1",
    workflowId: "wf1",
    workflow,
    nodes: graph.nodes,
    edges: graph.edges,
    variables,
    onWorkflow: (incoming) => {
      const canvas = workflowToCanvas(incoming);
      setGraph(canvas);
      updateVariables(canvas.variables);
      setWorkflow(incoming);
      setHydration((n) => n + 1);
    },
    onDetached: () => {},
  });
  useAutoSave({
    workflowId: "wf1",
    autoSaveEnabled: true,
    nodes: graph.nodes,
    edges: graph.edges,
    workflowVariables: variables,
    resetSnapshotKey: hydration,
    saveWorkflow: save,
  });

  return <span data-testid="nodes">{graph.nodes.map((n) => n.id).join(",")}</span>;
}

function mount(initial: Workflow) {
  let listener: Listener | null = null;
  onWorkflowChangedMock.mockImplementation((callback: Listener) => {
    listener = callback;
    return () => {
      listener = null;
    };
  });
  const save = vi.fn(() => Promise.resolve(true));
  const view = render(
    <PaletteProvider>
      <WorkflowProvider workflowId="wf1" initialWorkflow={initial}>
        <CanvasWiring initial={initial} save={save} />
      </WorkflowProvider>
    </PaletteProvider>,
  );
  const emit = (workflow: Workflow) =>
    act(() => listener?.({ kind: "upsert", workflow } as WorkflowChangedEvent));
  return { save, emit, view };
}

describe("live updates and auto-save on a clean canvas (FB-006)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    onWorkflowChangedMock.mockReset();
  });
  afterEach(() => vi.useRealTimers());

  it("does not save a workflow just because it was opened", () => {
    const { save } = mount(makeWorkflow(1, { token: "$.body.token" }));

    act(() => vi.advanceTimersByTime(2000));

    expect(save).not.toHaveBeenCalled();
  });

  it("applies an external snapshot without writing it back", () => {
    const { save, emit, view } = mount(makeWorkflow(1, { token: "$.body.token" }));
    act(() => vi.advanceTimersByTime(2000));

    const external = makeWorkflow(2, { token: "$.body.token", userId: "$.body.id" });
    external.nodes.push({
      nodeId: "wait",
      type: "delay",
      position: { x: 400, y: 0 },
      config: { duration: 10 },
    });
    emit(external);
    act(() => vi.advanceTimersByTime(2000));

    expect(view.getByTestId("nodes").textContent).toContain("wait");
    expect(save).not.toHaveBeenCalled();
  });
});
