import { memo, useCallback, useMemo } from 'react';
import { useReactFlow } from 'reactflow';
import { Clock } from 'lucide-react';
import { BaseNode } from '../atoms/flow/BaseNode';
import type { DelayNodeProps } from '../../types/DelayNodeProps';

const DelayNode = ({ id, data, selected }: DelayNodeProps) => {
  const { setNodes } = useReactFlow();

  const updateNodeData = useCallback((value: number) => {
    setNodes((nds) =>
      nds.map((node) =>
        node.id === id
          ? { ...node, data: { ...node.data, config: { ...node.data.config, duration: value } } }
          : node
      )
    );
  }, [id, setNodes]);

  const duration = data.config?.duration ?? 1000;
  const humanLabel = duration >= 1000 ? `${(duration / 1000).toFixed(1)}s` : `${duration}ms`;

  const icon = useMemo(() => (
    <Clock className="w-4 h-4" style={{ color: 'var(--aw-status-warning)' }} />
  ), []);

  const titleExtra = useMemo(() => (
    <span
      className="text-[10px] font-mono px-1.5 py-0.5 rounded-sm bg-[var(--aw-status-warning)]/10 text-status-warning dark:text-status-warning-dark border border-status-warning/30"
    >
      {humanLabel}
    </span>
  ), [humanLabel]);

  return (
    <BaseNode
      title={data.label ?? 'Delay'}
      icon={icon}
      status={data.executionStatus ?? 'idle'}
      selected={selected ?? false}
      nodeId={id}
      handleLeft={{ type: 'target' }}
      handleRight={{ type: 'source' }}
      collapsible={true}
      defaultExpanded={false}
      titleExtra={titleExtra}
      className="min-w-[180px]"
    >
      {({ isExpanded }) => (
        <div className="p-3 space-y-1.5">
          <div className="text-[10px]" style={{ color: 'var(--aw-text-muted)' }}>
            Wait before next step
          </div>

          {!isExpanded && duration > 0 && (
            <div
              className="text-[9px] px-1.5 py-0.5 rounded-sm inline-block bg-surface-overlay dark:bg-surface-dark-overlay text-text-secondary dark:text-text-secondary-dark font-mono"
            >
              {humanLabel}
            </div>
          )}

          {isExpanded && (
            <div className="flex items-center gap-1.5 pt-1 border-t" style={{ borderColor: 'var(--aw-border)' }}>
              <input
                type="number"
                aria-label="Delay duration in milliseconds"
                className="nodrag flex-1 px-1.5 py-0.5 border rounded-sm text-xs font-mono focus-visible:outline-2 focus-visible:outline-[var(--aw-primary)] focus-visible:outline-offset-[var(--aw-focus-ring-offset)]"
                style={{ borderColor: 'var(--aw-border)', backgroundColor: 'var(--aw-surface-raised)', color: 'var(--aw-text-primary)' }}
                value={duration}
                onChange={(e) => updateNodeData(parseInt(e.target.value) || 0)}
                min="0"
              />
              <span className="text-[10px] font-medium" style={{ color: 'var(--aw-text-secondary)' }}>ms</span>
            </div>
          )}
        </div>
      )}
    </BaseNode>
  );
};

export default memo(DelayNode);
