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
        borderRadius: 12,
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
          strokeWidth: 2,
          stroke: isRunning ? 'var(--aw-primary)' : undefined,
          ...(isRunning ? { strokeDasharray: '5,5' } : {}),
          ...style,
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
            className="w-5 h-5 bg-surface dark:bg-surface-dark-raised border border-border dark:border-border-dark
              text-text-muted dark:text-text-muted-dark hover:text-red-500 dark:hover:text-red-400
              hover:border-red-300 dark:hover:border-red-600 rounded-full flex items-center justify-center
              transition-all opacity-0 hover:opacity-100 shadow-sm"
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
