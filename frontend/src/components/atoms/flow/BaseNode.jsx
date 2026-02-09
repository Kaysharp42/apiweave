import React from 'react';
import { Handle, Position } from 'reactflow';

/**
 * BaseNode — Shared node shell for all ReactFlow nodes.
 *
 * Provides a consistent look: border, title bar (icon + label + status),
 * content area, and optional handles. Inspired by FlowTest's FlowNode.js.
 *
 * @param {string} title         — node title
 * @param {React.ReactNode} icon — icon element for the title bar
 * @param {'idle'|'running'|'success'|'error'} status
 * @param {boolean} selected     — ReactFlow selection state
 * @param {object|false} handleLeft  — { type, id, style } or false to hide
 * @param {object|false} handleRight — { type, id, style } or false to hide
 * @param {string} borderColor   — Tailwind border class override
 */
export default function BaseNode({
  children,
  title,
  icon,
  status = 'idle',
  selected = false,
  handleLeft = false,
  handleRight = false,
  className = '',
}) {
  const statusStyles = {
    idle: 'border-border dark:border-border-dark',
    running: 'border-status-running animate-pulse-border',
    success: 'border-status-success',
    error: 'border-status-error',
  };

  const statusDot = {
    idle: null,
    running: 'bg-status-running',
    success: 'bg-status-success',
    error: 'bg-status-error',
  };

  const borderClass = statusStyles[status] ?? statusStyles.idle;
  const dotClass = statusDot[status];

  return (
    <>
      {/* Left handle */}
      {handleLeft && (
        <Handle
          type={handleLeft.type ?? 'target'}
          position={Position.Left}
          id={handleLeft.id}
          style={handleLeft.style}
          className="!w-3 !h-3 !bg-primary !border-2 !border-white dark:!border-gray-800"
        />
      )}

      {/* Node body */}
      <div
        className={[
          'flex flex-col rounded-lg border-2 shadow-node bg-surface-raised dark:bg-surface-dark-raised min-w-[180px] max-w-node',
          borderClass,
          selected && 'ring-2 ring-primary ring-offset-1',
          className,
        ]
          .filter(Boolean)
          .join(' ')}
      >
        {/* Title bar */}
        {title && (
          <div className="flex items-center gap-2 px-3 py-2 border-b border-border dark:border-border-dark">
            {icon && <span className="flex-shrink-0 w-4 h-4 text-text-secondary dark:text-text-secondary-dark">{icon}</span>}
            <span className="flex-1 text-sm font-semibold text-text-primary dark:text-text-primary-dark truncate">
              {title}
            </span>
            {dotClass && (
              <span className={`w-2 h-2 rounded-full ${dotClass}`} aria-label={`Status: ${status}`} />
            )}
          </div>
        )}

        {/* Content area */}
        {children && <div className="p-3">{children}</div>}
      </div>

      {/* Right handle */}
      {handleRight && (
        <Handle
          type={handleRight.type ?? 'source'}
          position={Position.Right}
          id={handleRight.id}
          style={handleRight.style}
          className="!w-3 !h-3 !bg-primary !border-2 !border-white dark:!border-gray-800"
        />
      )}
    </>
  );
}
