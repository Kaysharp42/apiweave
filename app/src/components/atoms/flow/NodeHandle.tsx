import { Handle, Position, useNodeConnections, useNodeId } from "@xyflow/react";
import type { NodeHandleProps } from "../../../types/NodeHandleProps";

/**
 * A connection socket.
 *
 * At rest this reads as a socket, not a button: an 8px neutral dot, no ring.
 * The teal accent means "you can touch this", so it appears on node hover and
 * while a connection is being dragged — not permanently (DESIGN.md §7).
 *
 * **A socket that already has an edge hides itself** until the node is hovered
 * or a connection is in flight: the edge is the affordance from then on, and a
 * dot sitting under it is just something for the eye to trip over. A socket
 * with *no* edge stays visible — hiding that one would leave a first-time user
 * with nothing on the canvas to say a node can be connected at all. `data-
 * connected` is the hook; the rules are in `index.css`.
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
  // `useNodeConnections` throws on a falsy node id rather than returning
  // nothing, so a handle rendered outside a node — a unit test, a preview —
  // would take the whole tree down. An id that is not in the lookup is fine
  // by it and answers "no connections", which is the truth for a detached
  // handle: it stays visible.
  const nodeId = useNodeId();
  const connections = useNodeConnections({
    id: nodeId ?? "aw-detached-handle",
    handleType: type,
    ...(id && { handleId: id }),
  });

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
      data-connected={connections.length > 0 ? "true" : "false"}
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
