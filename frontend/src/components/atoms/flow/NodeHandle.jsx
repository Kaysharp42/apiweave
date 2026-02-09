import React from 'react';
import { Handle } from 'reactflow';

/**
 * NodeHandle — Styled ReactFlow handle.
 *
 * Rectangular style inspired by FlowTest, color-coded by type.
 *
 * @param {'source'|'target'} type
 * @param {'top'|'bottom'|'left'|'right'} position — ReactFlow Position string
 * @param {string} color — Tailwind bg-color override (e.g., 'bg-status-success')
 */
export default function NodeHandle({
  type = 'source',
  position = 'right',
  id,
  color,
  className = '',
  style,
  ...rest
}) {
  const positionMap = {
    top: 'top',
    bottom: 'bottom',
    left: 'left',
    right: 'right',
  };

  const defaultColor = type === 'source' ? '!bg-primary' : '!bg-primary-light';

  return (
    <Handle
      type={type}
      position={positionMap[position] ?? position}
      id={id}
      style={style}
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
