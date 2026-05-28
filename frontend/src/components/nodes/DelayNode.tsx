import { memo, useCallback, useMemo } from 'react';
import { useReactFlow } from 'reactflow';
import { Clock } from 'lucide-react';
import { BaseNode } from '../atoms/flow/BaseNode';
import type { NodeStatus } from '../../types/NodeStatus';

interface DelayNodeData {
  label?: string;
  executionStatus?: NodeStatus;
  config?: {
    duration?: number;
  };
}

interface DelayNodeProps {
  id: string;
  data: DelayNodeData;
  selected?: boolean;
}

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
  const icon = useMemo(() => <Clock className="w-4 h-4 text-yellow-700 dark:text-yellow-300" />, []);
  const titleExtra = useMemo(() => (
    <span className="text-[10px] font-mono text-yellow-700 dark:text-yellow-300 bg-yellow-100 dark:bg-yellow-800/40 px-1.5 py-0.5 rounded">
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
      headerBg="bg-yellow-50 dark:bg-yellow-900/60"
      headerTextClass="text-yellow-800 dark:text-yellow-200"
      titleExtra={titleExtra}
      className="min-w-[180px]"
    >
      {() => (
        <div className="p-3 space-y-1.5">
          <div className="text-[10px] text-text-muted dark:text-text-muted-dark">
            Wait before next step
          </div>
          <div className="flex items-center gap-1.5">
            <input
              type="number"
              aria-label="Delay duration in milliseconds"
              className="nodrag flex-1 px-1.5 py-0.5 border border-border dark:border-border-dark
                bg-surface dark:bg-surface-dark-raised text-text-primary dark:text-text-primary-dark
                rounded text-xs focus:outline-none focus:ring-2 focus:ring-primary"
              value={duration}
              onChange={(e) => updateNodeData(parseInt(e.target.value) || 0)}
              min="0"
            />
            <span className="text-[10px] font-medium text-text-secondary dark:text-text-secondary-dark">ms</span>
          </div>
        </div>
      )}
    </BaseNode>
  );
};

export default memo(DelayNode);
