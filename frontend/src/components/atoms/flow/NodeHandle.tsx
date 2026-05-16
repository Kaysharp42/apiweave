import React from 'react';
import { Handle, Position } from 'reactflow';

export interface NodeHandleProps {
  type?: 'source' | 'target';
  position?: 'top' | 'bottom' | 'left' | 'right';
  id?: string;
  color?: string;
  className?: string;
  style?: React.CSSProperties;
}

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

  const defaultColor = type === 'source' ? '!bg-primary' : '!bg-primary-light';

  return (
    <Handle
      type={type}
      position={positionMap[position] ?? Position.Right}
      {...(id && { id })}
      {...(style && { style })}
      className={[
        '!w-3 !h-3 !rounded-sm !border-2 !border-white dark:!border-gray-800',
        color ?? defaultColor,
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      {...rest}
    />
  );
}
