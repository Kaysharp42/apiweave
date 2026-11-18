import { NodeHandle } from "./NodeHandle";
import type { BaseNodeProps } from "../../../types/BaseNodeProps";
import type { StreamOutputHandleProps } from "../../../types";

/**
 * The second of a stream node's two outputs. `ready` is the node's main right
 * handle (see `handleRight` on the node), and `complete` sits just below it.
 * A stream node without both sockets cannot be wired: ReactFlow only offers a
 * connection from a handle that exists, and an edge carrying a handle the node
 * does not draw is invisible.
 */
export function StreamOutputHandle({ id, label, offsetY }: StreamOutputHandleProps) {
  return (
    <div className="group absolute" style={{ top: "50%", right: 0, transform: `translateY(${offsetY}px)` }}>
      <NodeHandle type="source" position="right" id={id} style={{ position: "relative" }} />
      <span className="pointer-events-none absolute right-3 -top-1.5 whitespace-nowrap text-2xs font-semibold uppercase tracking-wide text-text-secondary opacity-0 transition-opacity group-hover:opacity-100 dark:text-text-secondary-dark">
        {label}
      </span>
    </div>
  );
}

/** A stream node's sockets: one input, then `ready` with `complete` just below it. */
export const STREAM_NODE_HANDLES: Pick<BaseNodeProps, "handleLeft" | "handleRight" | "extraHandles"> = {
  handleLeft: { type: "target" },
  handleRight: { type: "source", id: "ready", style: { top: "calc(50% - 10px)" } },
  extraHandles: <StreamOutputHandle id="complete" label="complete" offsetY={10} />,
};
