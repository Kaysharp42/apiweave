import React, { useState } from 'react';
import { Handle, Position } from 'reactflow';
import { ChevronDown, ChevronUp, MoreHorizontal, Files, Copy } from 'lucide-react';
import useCanvasStore from '../../../stores/CanvasStore';

/**
 * BaseNode — Shared node shell for all ReactFlow nodes.
 *
 * Provides a consistent look: border, title bar (icon + label + status + collapse toggle),
 * content area, and optional handles. Inspired by FlowTest's FlowNode.js.
 *
 * Props:
 * @param {string}  title          — node title
 * @param {React.ReactNode} icon   — icon element for the title bar
 * @param {'idle'|'running'|'success'|'error'|'warning'} status
 * @param {boolean} selected       — ReactFlow selection state
 * @param {object|false} handleLeft  — { type, id, style } or false to hide
 * @param {object|false} handleRight — { type, id, style } or false to hide
 * @param {Array}   extraHandles   — additional Handle elements (e.g. dual pass/fail)
 * @param {string}  headerBg       — Tailwind class override for header background
 * @param {string}  headerTextClass — Tailwind class override for header text color
 * @param {string}  nodeId         — ReactFlow node id (for duplicate/copy events)
 * @param {boolean} collapsible    — show collapse/expand toggle (default true)
 * @param {boolean} defaultExpanded — initial collapsed/expanded state
 * @param {boolean} showMenu       — show three-dot context menu (default true)
 * @param {string}  statusBadgeText — optional text for status badge (e.g. "running")
 * @param {React.ReactNode} titleExtra — extra elements after title (badges etc.)
 * @param {string}  className      — extra className on the outer body div
 */
export default function BaseNode({
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
}) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const [menuOpen, setMenuOpen] = useState(false);

  const statusBorder = {
    idle: 'border-border dark:border-border-dark',
    running: 'border-status-running animate-pulse-border',
    success: 'border-status-success',
    error: 'border-status-error',
    warning: 'border-amber-500',
  };

  const statusDotColor = {
    idle: null,
    running: 'bg-status-running',
    success: 'bg-status-success',
    error: 'bg-status-error',
    warning: 'bg-amber-500',
  };

  const statusBadgeStyle = {
    running: 'bg-yellow-200 dark:bg-yellow-900 text-yellow-800 dark:text-yellow-200',
    success: 'bg-green-200 dark:bg-green-900 text-green-800 dark:text-green-200',
    error: 'bg-red-200 dark:bg-red-900 text-red-800 dark:text-red-200',
    warning: 'bg-orange-200 dark:bg-orange-900 text-orange-800 dark:text-orange-200',
  };

  const borderClass = statusBorder[status] ?? statusBorder.idle;
  const dotClass = statusDotColor[status];
  const badgeClass = statusBadgeStyle[status];

  return (
    <>
      {/* Left handle */}
      {handleLeft && (
        <Handle
          type={handleLeft.type ?? 'target'}
          position={Position.Left}
          id={handleLeft.id}
          style={handleLeft.style}
          className="!w-3 !h-3 !bg-primary !border-2 !border-white dark:!border-gray-800 !rounded-sm"
        />
      )}

      {/* Node body */}
      <div
        className={[
          'flex flex-col rounded-lg border-2 shadow-node bg-surface-raised dark:bg-surface-dark-raised min-w-[180px] max-w-node transition-shadow',
          borderClass,
          selected && 'ring-2 ring-primary ring-offset-1 shadow-node-selected',
          status === 'error' && 'shadow-[0_0_8px_rgba(220,38,38,0.25)]',
          className,
        ]
          .filter(Boolean)
          .join(' ')}
        style={{ fontSize: '12px' }}
      >
        {/* Title bar */}
        {title && (
          <div
            className={[
              'flex items-center gap-2 px-3 py-2 border-b border-border dark:border-border-dark rounded-t-lg',
              headerBg || 'bg-surface-overlay dark:bg-surface-dark-overlay',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            {icon && (
              <span className={`flex-shrink-0 w-4 h-4 ${headerTextClass || 'text-text-secondary dark:text-text-secondary-dark'}`}>
                {icon}
              </span>
            )}
            <span
              className={`flex-1 text-sm font-semibold truncate ${headerTextClass || 'text-text-primary dark:text-text-primary-dark'}`}
            >
              {title}
            </span>

            {/* Title extras (badges) */}
            {titleExtra}

            {/* Status badge */}
            {badgeClass && statusBadgeText && (
              <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${badgeClass}`}>
                {statusBadgeText}
              </span>
            )}

            {/* Status dot */}
            {dotClass && !statusBadgeText && (
              <span className={`w-2 h-2 rounded-full flex-shrink-0 ${dotClass}`} aria-label={`Status: ${status}`} />
            )}

            {/* Three-dot menu */}
            {showMenu && nodeId && (
              <div className="relative">
                <button
                  onClick={(e) => { e.stopPropagation(); setMenuOpen(!menuOpen); }}
                  className="p-0.5 text-text-secondary dark:text-text-secondary-dark hover:text-text-primary dark:hover:text-text-primary-dark nodrag focus:outline-none"
                  style={{ background: 'transparent', border: 'none', WebkitTapHighlightColor: 'transparent' }}
                  title="More options"
                >
                  <MoreHorizontal className="w-4 h-4" />
                </button>
                {menuOpen && (
                  <div className="absolute right-0 mt-1 bg-surface-raised dark:bg-surface-dark-raised border border-border dark:border-border-dark rounded-lg shadow-lg z-50 nodrag min-w-[120px] py-1">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        useCanvasStore.getState().duplicateNode(nodeId);
                        setMenuOpen(false);
                      }}
                      className="w-full text-left px-3 py-1.5 text-xs text-text-primary dark:text-text-primary-dark hover:bg-surface-overlay dark:hover:bg-surface-dark-overlay flex items-center gap-2"
                    >
                      <Files className="w-3.5 h-3.5" /> Duplicate
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        useCanvasStore.getState().copyNode(nodeId);
                        setMenuOpen(false);
                      }}
                      className="w-full text-left px-3 py-1.5 text-xs text-text-primary dark:text-text-primary-dark hover:bg-surface-overlay dark:hover:bg-surface-dark-overlay flex items-center gap-2 border-t border-border dark:border-border-dark"
                    >
                      <Copy className="w-3.5 h-3.5" /> Copy
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Collapse toggle */}
            {collapsible && (
              <button
                onClick={() => setIsExpanded(!isExpanded)}
                className="p-0.5 text-text-secondary dark:text-text-secondary-dark hover:text-text-primary dark:hover:text-text-primary-dark nodrag focus:outline-none"
                style={{ background: 'transparent', border: 'none', WebkitTapHighlightColor: 'transparent' }}
                aria-expanded={isExpanded}
                title={isExpanded ? 'Collapse' : 'Expand'}
              >
                {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </button>
            )}
          </div>
        )}

        {/* Content area */}
        {children && typeof children === 'function'
          ? children({ isExpanded, setIsExpanded })
          : children && <div className="p-3">{children}</div>}
      </div>

      {/* Right handle */}
      {handleRight && (
        <Handle
          type={handleRight.type ?? 'source'}
          position={Position.Right}
          id={handleRight.id}
          style={handleRight.style}
          className="!w-3 !h-3 !bg-primary !border-2 !border-white dark:!border-gray-800 !rounded-sm"
        />
      )}

      {/* Extra handles (e.g. assertion pass/fail) */}
      {extraHandles}
    </>
  );
}
