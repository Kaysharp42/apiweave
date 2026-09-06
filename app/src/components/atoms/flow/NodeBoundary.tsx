import React from "react";
import { AlertTriangle, RotateCw } from "lucide-react";
import { getLogger } from "../../../utils/logger";

const log = getLogger("NodeBoundary");

/**
 * A render error inside one node must not take the canvas with it.
 *
 * Without a boundary, React unmounts the whole tree from the nearest one it
 * finds — and the nearest one is above the canvas, so a single malformed
 * `config` on a single node blanks the workflow the user was looking at and
 * loses the viewport, the selection and any unsaved edit in a modal. Which is
 * the worst possible response to the least serious class of bug: the graph is
 * fine, the file is fine, one tile could not draw itself.
 *
 * So the boundary goes per node, at the `nodeTypes` map, and the failure is
 * drawn where the node was. The rest of the canvas never hears about it.
 *
 * Retry is a real affordance, not decoration: most of what reaches here is a
 * throw on data that a later live update or a reload replaces, so clearing the
 * error and re-rendering usually works. It is also the only escape — React
 * boundaries do not reset themselves.
 */

interface NodeBoundaryProps {
  /** Node id, for the log line and so the user can find it in the JSON. */
  nodeId: string;
  /** Registered node type, e.g. `http-request`. */
  nodeType: string;
  children: React.ReactNode;
}

interface NodeBoundaryState {
  error: Error | null;
}

class NodeBoundary extends React.Component<NodeBoundaryProps, NodeBoundaryState> {
  state: NodeBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): NodeBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    log.error(
      `node ${this.props.nodeId} (${this.props.nodeType}) failed to render: ${error.message}`,
      info.componentStack,
    );
  }

  private readonly retry = (event: React.MouseEvent): void => {
    event.stopPropagation();
    this.setState({ error: null });
  };

  render(): React.ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div
        // `nodrag` so the retry button is clickable: without it React Flow
        // claims the pointerdown for a node drag and the click never lands.
        className="nodrag flex min-w-[180px] max-w-node flex-col gap-2 rounded-node border border-status-error/60 bg-surface p-3 shadow-node-raised dark:bg-surface-dark"
        role="alert"
      >
        <div className="flex items-center gap-2">
          <AlertTriangle
            className="h-4 w-4 flex-shrink-0 text-status-error"
            aria-hidden="true"
          />
          <span className="text-xs font-medium text-text-primary dark:text-text-primary-dark">
            {this.props.nodeType} failed to render
          </span>
        </div>
        <p className="break-words font-mono text-[11px] leading-snug text-text-secondary dark:text-text-secondary-dark">
          {error.message}
        </p>
        <button
          type="button"
          onClick={this.retry}
          className="flex items-center gap-1.5 self-start rounded-node-ctl border-none bg-transparent p-1 text-xs text-text-secondary hover:bg-surface-overlay hover:text-text-primary dark:text-text-secondary-dark dark:hover:bg-surface-dark-overlay dark:hover:text-text-primary-dark cursor-pointer transition-colors motion-reduce:transition-none"
        >
          <RotateCw className="h-3.5 w-3.5" aria-hidden="true" />
          Retry
        </button>
      </div>
    );
  }
}

/**
 * Wrap a node component so it cannot break the canvas. Applied once, in the
 * `nodeTypes` map, so a new node kind is covered by being registered.
 */
export function withNodeBoundary<P extends { id: string }>(
  Node: React.ComponentType<P>,
  nodeType: string,
): React.ComponentType<P> {
  const Wrapped = (props: P): React.ReactElement => (
    <NodeBoundary nodeId={props.id} nodeType={nodeType}>
      <Node {...props} />
    </NodeBoundary>
  );
  Wrapped.displayName = `withNodeBoundary(${nodeType})`;
  return Wrapped;
}
