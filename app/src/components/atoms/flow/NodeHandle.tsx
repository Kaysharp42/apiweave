import { Handle, Position } from "reactflow";
import type { NodeHandleProps } from "../../../types/NodeHandleProps";

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

  const defaultColor = "!bg-[var(--aw-primary)]";

  return (
    <Handle
      type={type}
      position={positionMap[position] ?? Position.Right}
      {...(id && { id })}
      {...(style && { style })}
      className={[
        "!w-3 !h-3 !rounded-full !border !border-[var(--aw-surface-raised)] dark:!border-[var(--aw-surface-raised)]",
        color ?? defaultColor,
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      aria-label={`${type} handle`}
      {...rest}
    />
  );
}
