import { describe, expect, it } from "vitest";
import type { CanvasEdge } from "../types/CanvasEdge";
import { grpcCallType, reconcileGrpcStreamEdges } from "./grpcStreamEdges";

const GRPC = "grpc-1";
const OTHER = "http-1";

function edge(
  id: string,
  source: string,
  target: string,
  sourceHandle: string | null,
): CanvasEdge {
  return { id, source, target, sourceHandle, type: "custom" };
}

describe("reconcileGrpcStreamEdges", () => {
  it("turns an unnamed edge into ready when the call becomes server-streaming", () => {
    const edges = [
      edge("e1", GRPC, "end-1", null),
      { id: "e2", source: GRPC, target: "end-2" },
      edge("e3", GRPC, "end-3", ""),
      edge("e4", OTHER, "end-1", null),
    ];

    const next = reconcileGrpcStreamEdges(edges, GRPC, "server-streaming");

    expect(next[0]?.sourceHandle).toBe("ready");
    expect(next[1]?.sourceHandle).toBe("ready");
    expect(next[2]?.sourceHandle).toBe("ready");
    // Same ids: the handle moved, the edge is the same edge.
    expect(next.map((e) => e.id)).toEqual(["e1", "e2", "e3", "e4"]);
    // Another node's edge is not this node's output to rewire.
    expect(next[3]?.sourceHandle).toBeNull();
    // The input is left alone for the caller's previous snapshot.
    expect(edges[0]?.sourceHandle).toBeNull();
  });

  it("clears ready and complete when the call becomes unary", () => {
    const edges = [
      edge("e1", GRPC, "end-1", "ready"),
      edge("e2", GRPC, "end-2", "complete"),
      edge("e3", GRPC, "end-3", null),
      edge("e4", GRPC, "end-4", "pass"),
      edge("e5", OTHER, "end-1", "ready"),
    ];

    const next = reconcileGrpcStreamEdges(edges, GRPC, "unary");

    expect(next.slice(0, 4).map((e) => e.sourceHandle)).toEqual([
      null,
      null,
      null,
      "pass",
    ]);
    // Not this node's edges, not this rewrite's business.
    expect(next[4]?.sourceHandle).toBe("ready");
  });

  it("returns the same array when the edges already match the call type", () => {
    const unnamed: CanvasEdge[] = [
      edge("e1", GRPC, "end-1", null),
      edge("e2", OTHER, "end-1", null),
    ];
    expect(reconcileGrpcStreamEdges(unnamed, GRPC, "unary")).toBe(unnamed);

    const ready: CanvasEdge[] = [
      edge("e1", GRPC, "end-1", "ready"),
      edge("e2", OTHER, "end-1", null),
    ];
    expect(reconcileGrpcStreamEdges(ready, GRPC, "server-streaming")).toBe(
      ready,
    );
  });
});

describe("grpcCallType", () => {
  it("reads an absent callType as unary, as the panel, node and analyzer do", () => {
    expect(grpcCallType(undefined)).toBe("unary");
    expect(grpcCallType({})).toBe("unary");
    expect(grpcCallType({ callType: "unary" })).toBe("unary");
  });

  it("reads server-streaming only for that exact value", () => {
    expect(grpcCallType({ callType: "server-streaming" })).toBe(
      "server-streaming",
    );
    expect(grpcCallType({ callType: "bidirectional" })).toBe("unary");
  });
});
