import { describe, expect, it, vi } from "vitest";
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
  const { result } = renderHook(() => useMakeStepVariable({ nodesRef, setNodes, variables, setVariable }));
  return { nodesRef, setNodes, setVariable, result };
}

describe("useMakeStepVariable", () => {
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

  it("reuses a variable already holding the value without writing it again", () => {
    const { nodesRef, setVariable, result } = setup({ client: "ahm" });
    act(() => result.current.start("b1"));
    act(() => result.current.dialog.onSubmit({ field: "value", name: "client", everywhere: false }));
    expect(setVariable).not.toHaveBeenCalled();
    expect(nodesRef.current[0]?.data.config?.["value"]).toBe("{{variables.client}}");
    expect(nodesRef.current[1]).toBe(again);
  });

  it("changes nothing for a name holding a different value", () => {
    const { nodesRef, setNodes, setVariable, result } = setup({ client: "zed" });
    act(() => result.current.start("b1"));
    act(() => result.current.dialog.onSubmit({ field: "value", name: "client", everywhere: true }));
    expect(setVariable).not.toHaveBeenCalled();
    expect(setNodes).not.toHaveBeenCalled();
    expect(nodesRef.current[0]).toBe(fill);
  });
});
