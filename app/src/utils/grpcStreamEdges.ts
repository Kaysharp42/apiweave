import type { CanvasEdge } from "../types/CanvasEdge";
import type { GrpcCallType } from "../types/GrpcCallType";

/**
 * Rewrite a gRPC node's outgoing edges when its call type changes, so the
 * canvas draws the branch the runner will actually follow.
 *
 * The handle *is* the branch: a server-streaming node's run takes `ready` after
 * the call is accepted and `complete` after the stream closes, and ignores any
 * other handle. But ReactFlow attaches an edge with no handle to the node's
 * first source socket, so an edge left on `null` looks connected while the run
 * skips it — and an edge left on `ready`/`complete` after switching back to
 * unary is not drawn at all while the run still follows it. Becoming
 * server-streaming, an unnamed edge keeps the path it described: it runs as
 * soon as the call is accepted, so it becomes `ready`. Becoming unary, both
 * named handles become unnamed again, because that node has one unnamed output.
 *
 * Edge ids are deliberately untouched: they are opaque identity (run state and
 * revisions key on them), not a second encoding of the handle, and rebuilding
 * them from their endpoints would hand two parallel edges that both become
 * `ready` the same id.
 *
 * Returns `edges` itself when nothing changed, so a save that only edited an
 * address or a header does not touch canvas state.
 */
export function reconcileGrpcStreamEdges(
  edges: CanvasEdge[],
  nodeId: string,
  callType: GrpcCallType,
): CanvasEdge[] {
  let changed = false;
  const next = edges.map((edge) => {
    if (edge.source !== nodeId) return edge;
    const handle = edge.sourceHandle ?? null;
    if (callType === "server-streaming") {
      // "" is how the analyzer spells "no handle"; ReactFlow's own edges use null.
      if (handle !== null && handle !== "") return edge;
      changed = true;
      return { ...edge, sourceHandle: "ready" };
    }
    if (handle !== "ready" && handle !== "complete") return edge;
    changed = true;
    return { ...edge, sourceHandle: null };
  });
  return changed ? next : edges;
}

/**
 * The call type a canvas node is configured with. A missing `callType` is
 * `unary` everywhere else — the config panel's default, the node's own single
 * output and the analyzer all read it that way — so an older node whose config
 * predates the field is not treated as a third shape.
 */
export function grpcCallType(
  config: Record<string, unknown> | undefined,
): GrpcCallType {
  return config?.["callType"] === "server-streaming"
    ? "server-streaming"
    : "unary";
}
