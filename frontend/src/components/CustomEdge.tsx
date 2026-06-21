import { memo, useMemo, type CSSProperties } from 'react';
import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, useReactFlow, type EdgeProps } from 'reactflow';
import { X } from 'lucide-react';

interface CustomEdgeData {
  animated?: boolean;
}

type CustomEdgeProps = EdgeProps<CustomEdgeData>;

const EMPTY_EDGE_STYLE: CSSProperties = {};

function CustomEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style = EMPTY_EDGE_STYLE,
  markerEnd,
  data,
}: CustomEdgeProps) {
  const { deleteElements } = useReactFlow();

  const [edgePath, labelX, labelY] = useMemo(
    () =>
      getSmoothStepPath({
        sourceX,
        sourceY,
        sourcePosition,
        targetX,
        targetY,
        targetPosition,
        borderRadius: 4,
      }),
    [sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition],
  );

  const isRunning = data?.animated;

  const onEdgeClick = (event: React.MouseEvent) => {
    event.stopPropagation();
    deleteElements({ edges: [{ id }] });
  };

  return (
    <>
      <BaseEdge
        path={edgePath}
        markerEnd={markerEnd ?? ''}
        style={{
          ...style,
          strokeWidth: isRunning ? 1.5 : 1,
          stroke: isRunning ? 'var(--aw-primary)' : style.stroke ?? 'var(--aw-border)',
          ...(isRunning ? { strokeDasharray: '4 4' } : {}),
        }}
      />
      <EdgeLabelRenderer>
        <div
          style={{
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
            pointerEvents: 'all',
          }}
          className="nodrag nopan"
        >
          <button
            type="button"
            className="w-5 h-5 bg-surface-raised dark:bg-surface-dark-raised border border-border dark:border-border-dark
              text-text-muted dark:text-text-muted-dark hover:text-status-error dark:hover:text-status-error-dark
              hover:border-status-error dark:hover:border-status-error-dark rounded-sm flex items-center justify-center
              transition-colors motion-reduce:transition-none opacity-0 hover:opacity-100 shadow-node"
            onClick={onEdgeClick}
            title="Delete edge"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

export default memo(CustomEdge);
