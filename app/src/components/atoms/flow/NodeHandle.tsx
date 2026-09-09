import { Handle, Position } from "@xyflow/react";
import type { NodeHandleProps } from "../../../types/NodeHandleProps";

/**
 * A connection socket — the plug an edge visibly lands in.
 *
 * At rest this reads as a socket, not a button: an 8px neutral dot, no ring.
 * The teal accent means "you can touch this", so it appears on node hover and
 * while a connection is being dragged — not permanently (DESIGN.md §7).
 *
 * **The element is 8px, and that is deliberate.** ReactFlow derives an edge's
 * attachment point from this box's *outer face*, not its centre, so the box is
 * the socket and nothing more; a bigger box pushes every edge off the node it
 * is supposed to join. The 20px pointer target is a pseudo-element instead,
 * which the measurement never sees. All of it — the geometry, the hover,
 * connecting and focus states — lives in `index.css` next to the other
 * `.react-flow__handle` rules, since it keys off ReactFlow's own classes and
 * off the parent node's hover.
 */
export function NodeHandle({
  type = "source",
  position = "right",
  id,
  color,
  className = "",
  style,
  ...rest
}: NodeHandleProps) {
  const positionMap: Record<string, Position> = {
    top: Position.Top,
    bottom: Position.Bottom,
    left: Position.Left,
    right: Position.Right,
  };

  return (
    <Handle
      type={type}
      position={positionMap[position] ?? Position.Right}
      {...(id && { id })}
      {...(style && { style })}
      className={[
        "aw-node-handle !h-2 !w-2 !min-w-0 !min-h-0 !rounded-full !border-0 !bg-transparent",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      aria-label={`${type} handle`}
      {...rest}
    >
      <span
        aria-hidden="true"
        className="aw-node-handle__dot"
        {...(color && { "data-handle-color": color })}
        {...(color && {
          style: { "--aw-handle-color": color } as React.CSSProperties,
        })}
      />
    </Handle>
  );
}
