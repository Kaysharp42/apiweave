import { Globe } from "lucide-react";
import { Badge } from "../../atoms/Badge";
import type { WorkflowItemBadgesProps } from "../../../types";

/**
 * The node-count / project / environment badges under a workflow row's name.
 *
 * Its own component because two of the three are conditional, and inline in
 * `WorkflowItem` those conditionals sat several JSX levels deep in a body that
 * was already at the cognitive-complexity limit.
 */
export function WorkflowItemBadges({
  nodeCount,
  labels,
  hideProject = false,
}: WorkflowItemBadgesProps) {
  return (
    // One line, always: wrapping made some cards taller than their neighbours.
    <div className="mt-0.5 flex min-w-0 items-center gap-1 overflow-hidden whitespace-nowrap text-2xs text-text-secondary dark:text-text-secondary-dark">
      <Badge variant="ghost" size="xs" className="shrink-0">
        {nodeCount} nodes
      </Badge>

      {!hideProject && labels.collection && (
        <Badge
          variant="ghost"
          size="xs"
          className="max-w-30 min-w-0 truncate"
          title={labels.collection}
        >
          <span className="truncate">{labels.collection}</span>
        </Badge>
      )}

      {labels.environment && (
        <Badge
          variant="secondary"
          size="xs"
          className="max-w-30 min-w-0 truncate"
          title={labels.environment}
        >
          <Globe className="w-2.5 h-2.5 shrink-0" />
          <span className="truncate">{labels.environment}</span>
        </Badge>
      )}
    </div>
  );
}
