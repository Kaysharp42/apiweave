import React, { useState } from 'react';
import { Handle, Position } from 'reactflow';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { NodeActionMenu } from './NodeActionMenu';
import type { NodeStatus } from '../../../types/NodeStatus';

export interface HandleConfig {
  type?: 'source' | 'target';
  id?: string;
  style?: React.CSSProperties;
}

export interface BaseNodeProps {
  children?: React.ReactNode | (({ isExpanded, setIsExpanded }: { isExpanded: boolean; setIsExpanded: React.Dispatch<React.SetStateAction<boolean>> }) => React.ReactNode);
  title?: string;
  icon?: React.ReactNode;
  status?: NodeStatus;
  selected?: boolean;
  handleLeft?: HandleConfig | false;
  handleRight?: HandleConfig | false;
  extraHandles?: React.ReactNode;
  headerBg?: string;
  headerTextClass?: string;
  nodeId?: string;
  collapsible?: boolean;
  defaultExpanded?: boolean;
  showMenu?: boolean;
  statusBadgeText?: string;
  titleExtra?: React.ReactNode;
  className?: string;
}

export function BaseNode({
  children,
  title,
  icon,
  status = 'idle',
  selected = false,
  handleLeft = false,
  handleRight = false,
  extraHandles = null,
  headerBg = '',
  headerTextClass = '',
  nodeId,
  collapsible = true,
  defaultExpanded = false,
  showMenu = true,
  statusBadgeText = '',
  titleExtra = null,
  className = '',
}: BaseNodeProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  const statusBorder: Record<NodeStatus, string> = {
    idle: 'border-border dark:border-border-dark',
    running: 'border-status-running animate-pulse-border',
    success: 'border-status-success',
    error: 'border-status-error',
    warning: 'border-amber-500',
  };

  const statusDotColor: Record<NodeStatus, string | null> = {
    idle: null,
    running: 'bg-status-running',
    success: 'bg-status-success',
    error: 'bg-status-error',
    warning: 'bg-amber-500',
  };

  const statusBadgeStyle: Record<NodeStatus, string> = {
    running: 'bg-yellow-200 dark:bg-yellow-900 text-yellow-800 dark:text-yellow-200',
    success: 'bg-green-200 dark:bg-green-900 text-green-800 dark:text-green-200',
    error: 'bg-red-200 dark:bg-red-900 text-red-800 dark:text-red-200',
    warning: 'bg-orange-200 dark:bg-orange-900 text-orange-800 dark:text-orange-200',
    idle: '',
  };

  const borderClass = statusBorder[status] ?? statusBorder.idle;
  const dotClass = statusDotColor[status];
  const badgeClass = statusBadgeStyle[status];

  return (
    <>
      {handleLeft && (
        <Handle
          type={handleLeft.type ?? 'target'}
          position={Position.Left}
          id={handleLeft.id ?? ''}
          style={handleLeft.style ?? {}}
          className="!w-3 !h-3 !bg-primary !border-2 !border-white dark:!border-gray-800 !rounded-full"
        />
      )}

      <div
        className={[
          'flex flex-col rounded-2xl border-2 bg-surface-raised dark:bg-surface-dark-raised min-w-[180px] max-w-node overflow-hidden transition-all duration-150 shadow-[0_8px_24px_rgba(15,23,42,0.08)] dark:shadow-[0_10px_28px_rgba(2,6,23,0.45)]',
          borderClass,
          selected && 'ring-2 ring-primary/70 shadow-node-selected',
          status === 'error' && 'shadow-[0_0_8px_rgba(220,38,38,0.25)]',
          className,
        ]
          .filter(Boolean)
          .join(' ')}
        style={{ fontSize: '12px' }}
      >
        {title && (
          <div
            className={[
              'flex items-center gap-2.5 px-3 py-2.5 border-b border-border dark:border-border-dark',
              headerBg || 'bg-surface-overlay dark:bg-surface-dark-overlay',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            {icon && (
              <span className={`flex-shrink-0 flex items-center justify-center ${headerTextClass || 'text-text-secondary dark:text-text-secondary-dark'}`}>
                {icon}
              </span>
            )}
            <span
              className={`flex-1 text-sm font-semibold leading-tight truncate ${headerTextClass || 'text-text-primary dark:text-text-primary-dark'}`}
            >
              {title}
            </span>

            {titleExtra}

            {badgeClass && statusBadgeText && (
              <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${badgeClass}`}>
                {statusBadgeText}
              </span>
            )}

            {dotClass && !statusBadgeText && (
              <span className={`w-2 h-2 rounded-full flex-shrink-0 ${dotClass}`} aria-label={`Status: ${status}`} />
            )}

            {showMenu && nodeId && (
              <NodeActionMenu
                nodeId={nodeId}
                collapsible={collapsible}
                isExpanded={isExpanded}
                onDuplicate={() => {
                  // Will be wired up after CanvasStore migration
                }}
                onCopy={() => {
                  // Will be wired up after CanvasStore migration
                }}
                onToggleExpand={(nextExpanded: boolean) => setIsExpanded(nextExpanded)}
              />
            )}

            {collapsible && (
              <button
                type="button"
                onClick={() => setIsExpanded(!isExpanded)}
                className="p-1 rounded-md text-text-secondary dark:text-text-secondary-dark hover:text-text-primary dark:hover:text-text-primary-dark hover:bg-surface-overlay dark:hover:bg-surface-dark-overlay nodrag focus:outline-none"
                style={{ background: 'transparent', border: 'none', WebkitTapHighlightColor: 'transparent' }}
                aria-expanded={isExpanded}
                title={isExpanded ? 'Collapse' : 'Expand'}
              >
                {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </button>
            )}
          </div>
        )}

        {children && typeof children === 'function'
          ? children({ isExpanded, setIsExpanded })
          : children && <div className="p-3">{children}</div>}
      </div>

      {handleRight && (
        <Handle
          type={handleRight.type ?? 'source'}
          position={Position.Right}
          id={handleRight.id ?? ''}
          style={handleRight.style ?? {}}
          className="!w-3 !h-3 !bg-primary !border-2 !border-white dark:!border-gray-800 !rounded-full"
        />
      )}

      {extraHandles}
    </>
  );
}
