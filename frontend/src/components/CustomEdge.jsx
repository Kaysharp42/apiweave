import React from 'react';
import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, useReactFlow } from 'reactflow';
import { X } from 'lucide-react';

const CustomEdge = ({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style = {},
  markerEnd,
  data,
}) => {
  const { deleteElements } = useReactFlow();

  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    borderRadius: 12,
  });

  const isRunning = data?.animated;

  const onEdgeClick = (event) => {
    event.stopPropagation();
    deleteElements({ edges: [{ id }] });
  };

  return (
    <>
      <BaseEdge
        path={edgePath}
        markerEnd={markerEnd}
        style={{
          strokeWidth: 2,
          stroke: isRunning ? 'var(--color-primary, #6366f1)' : undefined,
          ...style,
        }}
        className={isRunning ? 'react-flow__edge-animated' : ''}
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
};

export default CustomEdge;