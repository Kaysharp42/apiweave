import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { useAcyclicConnections } from "./useAcyclicConnections";

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

const edgesRef = {
  current: [
    { source: "a", target: "b" },
    { source: "b", target: "c" },
  ],
};

function dropped(from: string, to: string, fromType: "source" | "target", isValid: boolean | null) {
  return { isValid, fromNode: { id: from }, toNode: { id: to }, fromHandle: { type: fromType } };
}

describe("useAcyclicConnections", () => {
  beforeEach(() => vi.mocked(toast.error).mockClear());

  it("refuses a connection that would close a cycle, a self-loop included", () => {
    const { result } = renderHook(() => useAcyclicConnections(edgesRef));
    expect(result.current.isValidConnection({ source: "c", target: "a" })).toBe(false);
    expect(result.current.isValidConnection({ source: "b", target: "b" })).toBe(false);
    expect(result.current.isValidConnection({ source: "a", target: "c" })).toBe(true);
  });

  it("explains a refused cycle when the edge is dropped, from either end", () => {
    const { result } = renderHook(() => useAcyclicConnections(edgesRef));
    const event = new MouseEvent("mouseup");
    result.current.onConnectEnd(event, dropped("c", "a", "source", false));
    result.current.onConnectEnd(event, dropped("a", "c", "target", false));
    expect(toast.error).toHaveBeenCalledTimes(2);
    expect(toast.error).toHaveBeenCalledWith("That connection would create a loop", expect.anything());
  });

  it("stays quiet for a valid drop or one refused for another reason", () => {
    const { result } = renderHook(() => useAcyclicConnections(edgesRef));
    const event = new MouseEvent("mouseup");
    result.current.onConnectEnd(event, dropped("a", "c", "source", true));
    result.current.onConnectEnd(event, dropped("a", "c", "source", false));
    expect(toast.error).not.toHaveBeenCalled();
  });
});
