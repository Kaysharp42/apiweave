import { describe, expect, it } from "vitest";
import { hasDuplicateConnection } from "./canvasConnections";

const connection = (
  source: string,
  target: string,
  sourceHandle: string | null = null,
  targetHandle: string | null = null,
) => ({ source, target, sourceHandle, targetHandle });

describe("hasDuplicateConnection", () => {
  const edges = [connection("check", "end", "pass")];

  it("finds the same nodes through the same handle", () => {
    expect(hasDuplicateConnection(edges, connection("check", "end", "pass"))).toBe(true);
  });

  it("treats the assertion's pass and fail branches as different edges", () => {
    expect(hasDuplicateConnection(edges, connection("check", "end", "fail"))).toBe(false);
  });

  it("treats another target or another input handle as a different edge", () => {
    expect(hasDuplicateConnection(edges, connection("check", "other", "pass"))).toBe(false);
    expect(hasDuplicateConnection([connection("a", "m", null, "left")], connection("a", "m", null, "right"))).toBe(false);
  });

  it("treats an empty handle and an absent one as the same unnamed port", () => {
    expect(hasDuplicateConnection([connection("a", "b")], connection("a", "b", ""))).toBe(true);
  });
});
