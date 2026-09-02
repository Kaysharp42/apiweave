import { Handle, Position } from "@xyflow/react";
import type { NodeHandleProps } from "../../../types/NodeHandleProps";

/**
 * A connection socket.
 *
 * At rest this reads as a socket, not a button: an 8px neutral dot, no ring.
 * The teal accent means "you can touch this", so it appears on node hover and
 * while a connection is being dragged — not permanently (DESIGN.md §7).
 *
 * **The visual size is not the hit area.** The `Handle` itself is a 20px
 * transparent box and the dot is drawn inside it, because an 8px pointer target
 * is undraggable. The hover, connecting and status styling lives in `index.css`
 * next to the other `.react-flow__handle` rules, since it keys off ReactFlow's
 * own classes and off the parent node's hover.
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
        "aw-node-handle !h-5 !w-5 !min-w-0 !min-h-0 !rounded-full !border-0 !bg-transparent",
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
