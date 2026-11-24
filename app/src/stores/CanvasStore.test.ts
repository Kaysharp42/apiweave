import { beforeEach, describe, expect, it } from "vitest";
import useCanvasStore from "./CanvasStore";
import type { NodeMenuRequest } from "../types/NodeMenuRequest";

const MENU: NodeMenuRequest = {
  nodeId: "node-1",
  x: 40,
  y: 80,
  collapsible: true,
};

beforeEach(() => {
  useCanvasStore.getState().resetCanvasNodeUi();
});

describe("CanvasStore node menu", () => {
  it("opens the menu at the request and closes it again", () => {
    useCanvasStore.getState().openNodeMenu(MENU);
    expect(useCanvasStore.getState().nodeMenu).toEqual(MENU);

    useCanvasStore.getState().closeNodeMenu();
    expect(useCanvasStore.getState().nodeMenu).toBeNull();
  });

  it("holds one menu at a time", () => {
    useCanvasStore.getState().openNodeMenu(MENU);
    useCanvasStore
      .getState()
      .openNodeMenu({ ...MENU, nodeId: "node-2", x: 10, y: 20 });

    expect(useCanvasStore.getState().nodeMenu?.nodeId).toBe("node-2");
  });
});

describe("CanvasStore node expansion", () => {
  it("expands and collapses a node with a fresh set", () => {
    const before = useCanvasStore.getState().expandedNodeIds;

    useCanvasStore.getState().setNodeExpanded("node-1", true);
    const expanded = useCanvasStore.getState().expandedNodeIds;
    expect(expanded).not.toBe(before);
    expect(expanded.has("node-1")).toBe(true);

    useCanvasStore.getState().setNodeExpanded("node-1", false);
    expect(useCanvasStore.getState().expandedNodeIds.has("node-1")).toBe(false);
  });

  it("does not notify subscribers when the state already matches", () => {
    useCanvasStore.getState().setNodeExpanded("node-1", true);
    const snapshot = useCanvasStore.getState().expandedNodeIds;

    let notifications = 0;
    const unsubscribe = useCanvasStore.subscribe(() => {
      notifications += 1;
    });

    useCanvasStore.getState().setNodeExpanded("node-1", true);
    useCanvasStore.getState().setNodeExpanded("node-2", false);
    unsubscribe();

    expect(notifications).toBe(0);
    expect(useCanvasStore.getState().expandedNodeIds).toBe(snapshot);
  });

  it("closes the menu and collapses every node on reset", () => {
    useCanvasStore.getState().openNodeMenu(MENU);
    useCanvasStore.getState().setNodeExpanded("node-1", true);
    useCanvasStore.getState().setNodeExpanded("node-2", true);

    useCanvasStore.getState().resetCanvasNodeUi();

    const state = useCanvasStore.getState();
    expect(state.nodeMenu).toBeNull();
    expect(state.expandedNodeIds.size).toBe(0);
  });
});
