import { Play, Square } from "lucide-react";
import { BaseNode } from "./BaseNode";
import type { TerminalNodeProps } from "../../../types/TerminalNodeProps";

/**
 * Everything that distinguishes `start` from `end`.
 *
 * A table rather than two components, because two components that instantiate
 * the same shell with different strings are the same component: the node files
 * had drifted into byte-for-byte copies apart from the copy.
 */
export const TERMINAL_NODE_PRESETS = {
  start: {
    title: "Start",
    icon: <Play className="w-3.5 h-3.5 fill-current" />,
    tileHue: "var(--aw-status-success)",
    restLine: "entry point",
    description:
      "Entry point for workflow execution. Connect this node to your first request or control step.",
    handleRight: { type: "source" as const },
  },
  end: {
    title: "End",
    icon: <Square className="w-3 h-3 fill-current" />,
    // Deliberately neutral rather than the old "End = red". A terminal node is
    // not a failed node, and red on this canvas means failure.
    tileHue: "var(--aw-text-secondary)",
    restLine: "final step",
    description:
      "Final step of the workflow. Use it to mark completion after all required branches and assertions finish.",
    handleLeft: { type: "target" as const },
  },
} as const;

/**
 * The shell shared by `start` and `end`.
 *
 * Both are the same node: an identity tile, a one-line label, a single handle,
 * and a sentence of prose behind the chevron. They carry no config and execute
 * nothing, but the run still passes through them, and a node the run reached
 * reports it the same way every other node does — the check, the border, the
 * settling glow, and the socket colour the outgoing edge agrees with.
 *
 * Everything that differs between them is a prop.
 */
export function TerminalNode({
  nodeId,
  selected,
  status = "idle",
  title,
  icon,
  tileHue,
  restLine,
  description,
  handleLeft = false,
  handleRight = false,
}: TerminalNodeProps) {
  // The only line this node ever shows, in every state. A terminal node has no
  // result to report beyond having been reached, so it is handed over as the
  // resting identity *and* as both run-strip lines — otherwise `BaseNode` drops
  // the rest line the moment the node has a status and leaves the slab blank.
  const line = { operation: restLine };

  return (
    <BaseNode
      title={title}
      icon={icon}
      tileHue={tileHue}
      status={status}
      selected={selected}
      nodeId={nodeId}
      handleLeft={handleLeft}
      handleRight={handleRight}
      collapsible={true}
      defaultExpanded={false}
      restLine={line}
      activityLine={line}
      resultSummary={line}
      className="min-w-[160px]"
    >
      {({ isExpanded }) =>
        isExpanded ? (
          <div className="p-3">
            <div className="text-xs leading-relaxed rounded-node-ctl border border-border dark:border-border-dark bg-surface-overlay dark:bg-surface-dark-overlay p-2 text-text-secondary dark:text-text-secondary-dark">
              {description}
            </div>
          </div>
        ) : null
      }
    </BaseNode>
  );
}
