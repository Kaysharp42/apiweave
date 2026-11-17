import { NodeHandle } from "./NodeHandle";
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
      <span className="pointer-events-none absolute right-3 top-[-5px] whitespace-nowrap text-2xs font-semibold uppercase tracking-wide text-text-secondary opacity-0 transition-opacity group-hover:opacity-100 dark:text-text-secondary-dark">
        {label}
      </span>
    </div>
  );
}
