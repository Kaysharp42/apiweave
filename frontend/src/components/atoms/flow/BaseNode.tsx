import React, { useState } from 'react';
import { Handle, Position } from 'reactflow';
import { ChevronDown, ChevronUp, Loader2, CheckCircle2, XCircle, AlertTriangle } from 'lucide-react';
import { NodeActionMenu } from './NodeActionMenu';
import type { NodeStatus } from '../../../types/NodeStatus';
import type { BaseNodeProps } from '../../../types/BaseNodeProps';

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

  const statusConfig: Record<
    NodeStatus,
    {
      border: string;
      bg: string;
      ring: string;
      dot: string | null;
      badge: string;
      icon: React.ReactNode | null;
      ariaLabel: string;
    }
  > = {
    idle: {
      border: 'border-border dark:border-border-dark',
      bg: '',
      ring: '',
      dot: null,
      badge: '',
      icon: null,
      ariaLabel: 'Idle',
    },
    running: {
      border: 'border-border dark:border-border-dark',
      bg: '',
      ring: 'animate-pulse motion-reduce:animate-none ring-2 ring-status-running/40 dark:ring-status-running/30',
      dot: 'bg-status-running',
      badge: 'bg-status-running/15 text-status-running dark:text-[var(--aw-status-running)]',
      icon: <Loader2 className="w-3.5 h-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />,
      ariaLabel: 'Running',
    },
    success: {
      border: 'border-status-success/60 dark:border-status-success/40',
      bg: '',
      ring: 'ring-1 ring-status-success/30 dark:ring-status-success/20',
      dot: 'bg-status-success',
      badge: 'bg-status-success/15 text-status-success dark:text-[var(--aw-status-success)]',
      icon: <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />,
      ariaLabel: 'Success',
    },
    error: {
      border: 'border-status-error/60 dark:border-status-error/40',
      bg: '',
      ring: 'ring-1 ring-status-error/30 dark:ring-status-error/20',
      dot: 'bg-status-error',
      badge: 'bg-status-error/15 text-status-error dark:text-[var(--aw-status-error)]',
      icon: <XCircle className="w-3.5 h-3.5" aria-hidden="true" />,
      ariaLabel: 'Error',
    },
    warning: {
      border: 'border-status-warning/60 dark:border-status-warning/40',
      bg: '',
      ring: 'ring-1 ring-status-warning/30 dark:ring-status-warning/20',
      dot: 'bg-status-warning',
      badge: 'bg-status-warning/15 text-status-warning dark:text-[var(--aw-status-warning)]',
      icon: <AlertTriangle className="w-3.5 h-3.5" aria-hidden="true" />,
      ariaLabel: 'Warning',
    },
  };

  const config = statusConfig[status] ?? statusConfig.idle;

  const selectedClasses = selected
    ? 'bg-surface-raised dark:bg-surface-dark-raised shadow-node-selected'
    : 'bg-surface-raised dark:bg-surface-dark-raised shadow-node hover:shadow-node-hover';

  const statusBg = !selected && config.bg ? config.bg : '';

  return (
    <>
      {handleLeft && (
        <Handle
          type={handleLeft.type ?? 'target'}
          position={Position.Left}
          id={handleLeft.id ?? ''}
          style={handleLeft.style ?? {}}
          className="!w-3 !h-3 !bg-[var(--aw-primary)] !border !border-[var(--aw-surface-raised)] dark:!border-[var(--aw-surface-raised)] !rounded-full"
        />
      )}

      <div
        className={[
          'flex flex-col rounded-sm border min-w-[180px] max-w-node overflow-hidden transition-shadow transition-colors duration-150 motion-reduce:transition-none',
          selectedClasses,
          config.border,
          config.ring,
          statusBg,
          className,
        ]
          .filter(Boolean)
          .join(' ')}
        style={{ fontSize: '12px' }}
        aria-label={`Node status: ${config.ariaLabel}`}
      >
        {title && (
          <div
            className={[
              'flex items-center gap-2 px-3 py-2 border-b border-border dark:border-border-dark',
              headerBg || 'bg-surface-raised dark:bg-surface-dark-raised',
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
              className={`flex-1 text-sm font-semibold leading-tight tracking-[-0.01em] truncate ${headerTextClass || 'text-text-primary dark:text-text-primary-dark'}`}
            >
              {title}
            </span>

            {titleExtra}

            {config.badge && statusBadgeText && (
              <span className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-sm font-mono ${config.badge}`}>
                {config.icon}
                {statusBadgeText}
              </span>
            )}

            {config.dot && !statusBadgeText && (
              <span className="inline-flex items-center gap-1.5 flex-shrink-0">
                {config.icon}
                <span className={`w-2 h-2 rounded-full ${config.dot}`} aria-label={`Status: ${status}`} />
              </span>
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
                className="p-1 rounded-sm text-text-secondary dark:text-text-secondary-dark hover:text-text-primary dark:hover:text-text-primary-dark hover:bg-surface-overlay dark:hover:bg-surface-dark-overlay nodrag focus-visible:outline-2 focus-visible:outline-[var(--aw-primary)] focus-visible:outline-offset-[var(--aw-focus-ring-offset)] cursor-pointer transition-colors motion-reduce:transition-none"
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
          className="!w-3 !h-3 !bg-[var(--aw-primary)] !border !border-[var(--aw-surface-raised)] dark:!border-[var(--aw-surface-raised)] !rounded-full"
        />
      )}

      {extraHandles}
    </>
  );
}
