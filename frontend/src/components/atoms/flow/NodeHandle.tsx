import { Handle, Position } from 'reactflow';
import type { NodeHandleProps } from '../../../types/NodeHandleProps';

export function NodeHandle({
  type = 'source',
  position = 'right',
  id,
  color,
  className = '',
  style,
  ...rest
}: NodeHandleProps) {
  const positionMap: Record<string, Position> = {
    top: Position.Top,
    bottom: Position.Bottom,
    left: Position.Left,
    right: Position.Right,
  };

  const defaultColor = type === 'source' ? '!bg-[var(--aw-primary)]' : '!bg-[var(--aw-primary-light)]';

  return (
    <Handle
      type={type}
      position={positionMap[position] ?? Position.Right}
      {...(id && { id })}
      {...(style && { style })}
      className={[
        '!w-3.5 !h-3.5 !rounded-sm !border-2 !border-[var(--aw-surface-raised)] dark:!border-[var(--aw-surface-dark)]',
        color ?? defaultColor,
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      aria-label={`${type} handle`}
      {...rest}
    />
  );
}
