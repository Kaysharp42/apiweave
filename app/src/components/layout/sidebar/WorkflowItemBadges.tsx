import { Globe } from "lucide-react";
import { Badge } from "../../atoms/Badge";
import type { WorkflowRowLabels } from "../../../types/WorkflowRowLabels";

interface WorkflowItemBadgesProps {
  readonly nodeCount: number;
  readonly labels: WorkflowRowLabels;
}

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
}: WorkflowItemBadgesProps) {
  return (
    <div className="mt-0.5 flex flex-wrap items-center gap-1 text-xxs text-text-secondary dark:text-text-secondary-dark overflow-hidden">
      <Badge variant="ghost" size="xs">
        {nodeCount} nodes
      </Badge>

      {labels.collection && (
        <Badge
          variant="info"
          size="xs"
          className="max-w-[7.5rem] min-w-0 truncate"
          title={labels.collection.fullLabel}
        >
          {labels.collection.label}
        </Badge>
      )}

      {labels.environment && (
        <Badge
          variant="secondary"
          size="xs"
          className="max-w-[7.5rem] min-w-0 truncate"
          title={labels.environment.fullLabel}
        >
          <Globe className="w-2.5 h-2.5 mr-0.5 flex-shrink-0" />
          {labels.environment.label}
        </Badge>
      )}
    </div>
  );
}
