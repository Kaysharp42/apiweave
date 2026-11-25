import { describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { toast } from "sonner";
import type { CanvasNode } from "../types/CanvasNode";
import { useTurnIntoExtract } from "./useTurnIntoExtract";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const total: CanvasNode = {
  id: "b1",
  type: "browser",
  position: { x: 0, y: 0 },
  data: { label: "Check text", config: { action: "expect-text", locator: { kind: "css", value: "#total" }, text: "42", match: "contains" } },
};
const open: CanvasNode = { id: "b2", type: "browser", position: { x: 0, y: 0 }, data: { config: { action: "navigate", url: "https://x.test/" } } };

function setup() {
  const nodesRef = { current: [total, open] };
  const setNodes = vi.fn();
  const { result } = renderHook(() => useTurnIntoExtract({ nodes: nodesRef.current, nodesRef, setNodes }));
  return { nodesRef, setNodes, result };
}

describe("useTurnIntoExtract", () => {
  it("is offered only for a step with an element", () => {
    const { result } = setup();
    expect(result.current.canTurn("b1")).toBe(true);
    expect(result.current.canTurn("b2")).toBe(false);
    expect(result.current.canTurn("missing")).toBe(false);
  });

  it("asks for a name, suggests one from the element, and turns the step into an extract", () => {
    const { nodesRef, setNodes, result } = setup();
    act(() => result.current.start("b1"));
    expect(result.current.dialog).toMatchObject({ open: true, nodeId: "b1", defaultValue: "total" });
    act(() => result.current.dialog.onSubmit("order total"));
    expect(result.current.dialog.open).toBe(false);
    expect(nodesRef.current[0]?.data).toEqual({
      label: "Save a value",
      config: { action: "extract", locator: { kind: "css", value: "#total" }, from: "text", variable: "ordertotal" },
    });
    expect(setNodes).toHaveBeenCalledWith(nodesRef.current);
    expect(toast.success).toHaveBeenCalledWith("The step now saves its element into {{variables.ordertotal}}");
  });

  it("changes nothing for a name with no letter in it", () => {
    const { nodesRef, setNodes, result } = setup();
    act(() => result.current.start("b1"));
    act(() => result.current.dialog.onSubmit("123 !"));
    expect(nodesRef.current[0]).toBe(total);
    expect(setNodes).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalled();
  });

  it.each(["_", "_1", "12_3"])("refuses %s, which cleans to no letter at all", (typed) => {
    const { nodesRef, setNodes, result } = setup();
    act(() => result.current.start("b1"));
    act(() => result.current.dialog.onSubmit(typed));
    expect(nodesRef.current[0]).toBe(total);
    expect(setNodes).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenLastCalledWith(
      "A variable name needs at least one letter A–Z. Unaccented letters, digits and _ only.",
    );
  });
});
