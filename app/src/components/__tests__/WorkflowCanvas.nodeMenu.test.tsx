import { describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import WorkflowCanvas from "../WorkflowCanvas";
import useCanvasStore from "../../stores/CanvasStore";
import { PaletteProvider } from "../../contexts/PaletteContext";

vi.mock("../../hooks/useScopeContext", () => ({
  useScopeContext: () => ({
    workspaceId: null,
    workspaceSlug: null,
    orgId: null,
    orgSlug: null,
    isReady: false,
  }),
}));

vi.mock("../../contexts/WorkflowContext", () => ({
  useWorkflow: () => ({
    variables: {},
    registerExtractors: vi.fn(),
    updateVariable: vi.fn(),
    updateVariables: vi.fn(),
    onVariablesDeletedRef: { current: null },
  }),
}));

function renderCanvas() {
  return render(
    <MemoryRouter>
      <PaletteProvider>
        <WorkflowCanvas workflowId="wf1" workflow={null} />
      </PaletteProvider>
    </MemoryRouter>,
  );
}

function openMenu() {
  useCanvasStore
    .getState()
    .openNodeMenu({ nodeId: "node-1", x: 10, y: 10, collapsible: true });
}

vi.mock("../../contexts/WorkspaceContext", () => ({
  useWorkspace: () => ({
    availableWorkspaces: [],
    currentWorkspace: null,
    currentOrg: null,
    orgs: [],
    switchTo: vi.fn(),
    refresh: vi.fn(),
    isLoading: false,
  }),
}));

describe("WorkflowCanvas node menu", () => {
  it("closes on a press inside the canvas even when the target stops propagation", () => {
    const { container } = renderCanvas();
    const canvas = container.querySelector("main");
    const pressed = canvas?.firstElementChild;
    expect(pressed).toBeInstanceOf(HTMLElement);

    // What ReactFlow's d3 drag/zoom do to a press on a node or the pane: the
    // document-level listener ContextMenu relies on never hears it.
    pressed!.addEventListener("mousedown", (event) =>
      event.stopImmediatePropagation(),
    );
    openMenu();

    fireEvent.mouseDown(pressed!);

    expect(useCanvasStore.getState().nodeMenu).toBeNull();
  });

  it("leaves the menu open for a press outside the canvas", () => {
    renderCanvas();
    openMenu();

    // The menu itself is portalled to <body>, outside the canvas element.
    const outside = document.createElement("div");
    document.body.appendChild(outside);
    fireEvent.mouseDown(outside);
    outside.remove();

    expect(useCanvasStore.getState().nodeMenu).not.toBeNull();
  });
});
