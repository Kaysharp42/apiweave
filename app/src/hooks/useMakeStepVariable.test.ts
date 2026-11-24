import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { toast } from "sonner";
import type { JsonValue } from "@shared/types/JsonValue";
import type { CanvasNode } from "../types/CanvasNode";
import { useMakeStepVariable } from "./useMakeStepVariable";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const fill: CanvasNode = {
  id: "b1",
  type: "browser",
  position: { x: 0, y: 0 },
  data: { label: "Fill Search client", config: { action: "fill", locator: { kind: "label", value: "Search client" }, value: "ahm" } },
};
const again: CanvasNode = {
  id: "b2",
  type: "browser",
  position: { x: 0, y: 0 },
  data: { label: "Typed by hand", config: { action: "fill", locator: { kind: "label", value: "Filter" }, value: "ahm" } },
};
const open: CanvasNode = { id: "b3", type: "browser", position: { x: 0, y: 0 }, data: { config: { action: "navigate", url: "https://x.test/" } } };

function setup(variables: Record<string, JsonValue> = {}) {
  const nodesRef = { current: [fill, again, open] };
  const setNodes = vi.fn();
  const setVariable = vi.fn();
  const { result, rerender } = renderHook(() => useMakeStepVariable({ nodesRef, setNodes, variables, setVariable }));
  return { nodesRef, setNodes, setVariable, result, rerender };
}

describe("useMakeStepVariable", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("is offered only for a step with a literal", () => {
    const { result } = setup();
    expect(result.current.canMake("b1")).toBe(true);
    expect(result.current.canMake("b3")).toBe(false);
    expect(result.current.canMake("missing")).toBe(false);
  });

  it("sets the variable and rewrites every step holding the value in one change", () => {
    const { nodesRef, setNodes, setVariable, result } = setup();
    act(() => result.current.start("b1"));
    expect(result.current.dialog).toMatchObject({ open: true, nodeId: "b1", node: fill });
    act(() => result.current.dialog.onSubmit({ field: "value", name: "searchClient", everywhere: true }));
    expect(result.current.dialog.open).toBe(false);
    expect(setVariable).toHaveBeenCalledWith("searchClient", "ahm");
    expect(nodesRef.current.map((node) => node.data.config?.["value"])).toEqual(["{{variables.searchClient}}", "{{variables.searchClient}}", undefined]);
    expect(nodesRef.current[0]?.data.label).toBe("Fill Search client");
    expect(nodesRef.current[1]?.data.label).toBe("Typed by hand");
    expect(setNodes).toHaveBeenCalledTimes(1);
    expect(setNodes).toHaveBeenCalledWith(nodesRef.current);
    expect(toast.success).toHaveBeenCalledWith("2 steps now use {{variables.searchClient}}");
  });

  it("releases the target when its step loses every literal, so the action opens it again", () => {
    const { nodesRef, result, rerender } = setup();
    act(() => result.current.start("b1"));
    expect(result.current.dialog.open).toBe(true);
    // An edit templates both of the step's literals while the dialog is open.
    nodesRef.current = nodesRef.current.map((each) =>
      each.id === "b1"
        ? { ...each, data: { ...each.data, config: { action: "fill", locator: { kind: "label", value: "{{variables.term}}" }, value: "{{variables.term}}" } } }
        : each,
    );
    rerender();
    expect(result.current.dialog).toMatchObject({ open: false, nodeId: null });
    // The literals return (an undo, say): the action opens a fresh dialog.
    nodesRef.current = [fill, again, open];
    rerender();
    act(() => result.current.start("b1"));
    expect(result.current.dialog).toMatchObject({ open: true, nodeId: "b1", node: fill });
  });

  it("reuses a variable already holding the value without writing it again", () => {
    const { nodesRef, setVariable, result } = setup({ client: "ahm" });
    act(() => result.current.start("b1"));
    act(() => result.current.dialog.onSubmit({ field: "value", name: "client", everywhere: false }));
    expect(setVariable).not.toHaveBeenCalled();
    expect(nodesRef.current[0]?.data.config?.["value"]).toBe("{{variables.client}}");
    expect(nodesRef.current[1]).toBe(again);
  });

  it("keeps the dialog open for a name that started holding a different value, and completes when it is fixed", () => {
    const { nodesRef, setNodes, setVariable, result } = setup({ client: "zed" });
    act(() => result.current.start("b1"));
    act(() => result.current.dialog.onSubmit({ field: "value", name: "client", everywhere: true }));
    expect(result.current.dialog.open).toBe(true);
    expect(setVariable).not.toHaveBeenCalled();
    expect(setNodes).not.toHaveBeenCalled();
    expect(nodesRef.current[0]).toBe(fill);
    expect(toast.error).toHaveBeenCalledWith("client already holds a different value. Pick another name.");
    // The dialog stayed open with the typed name: a free name finishes the job.
    act(() => result.current.dialog.onSubmit({ field: "value", name: "clientName", everywhere: true }));
    expect(result.current.dialog.open).toBe(false);
    expect(setVariable).toHaveBeenCalledWith("clientName", "ahm");
    expect(nodesRef.current.map((node) => node.data.config?.["value"])).toEqual([
      "{{variables.clientName}}",
      "{{variables.clientName}}",
      undefined,
    ]);
    expect(toast.success).toHaveBeenCalledWith("2 steps now use {{variables.clientName}}");
  });

  it("changes nothing, and says why, when the step no longer holds the value", () => {
    const { nodesRef, setNodes, setVariable, result } = setup();
    act(() => result.current.start("b1"));
    act(() => result.current.dialog.onSubmit({ field: "locator.hasText", name: "filter", everywhere: false }));
    expect(setVariable).not.toHaveBeenCalled();
    expect(setNodes).not.toHaveBeenCalled();
    expect(nodesRef.current[0]).toBe(fill);
    expect(toast.error).toHaveBeenCalledWith("That value is no longer in the step, so nothing was replaced.");
  });
});
