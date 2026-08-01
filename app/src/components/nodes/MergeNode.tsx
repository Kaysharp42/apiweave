import { memo, useMemo } from "react";
import {
  GitMerge,
  CheckCircle,
  SquareCheckBig,
  Filter,
  AlertTriangle,
  Clock,
  ArrowRight,
  Sparkles,
} from "lucide-react";
import { BaseNode } from "../atoms/flow/BaseNode";
import { OpenNodeEditorButton } from "../atoms/flow/OpenNodeEditorButton";
import type { MergeNodeProps, BranchInfo } from "../../types/MergeNodeProps";

const BranchMapping = ({ branches }: { branches: BranchInfo[] }) => (
  <div className="mt-1 space-y-1">
    {branches.map((b) => (
      <div
        key={b.index}
        className="text-xs p-1.5 rounded-node-ctl border border-border dark:border-border-dark bg-surface-raised dark:bg-surface-dark-raised"
      >
        <span className="font-medium truncate text-text-primary dark:text-text-primary-dark">
          {b.edgeLabel ?? b.label ?? `Branch ${b.index}`}
        </span>
        <span className="mx-1 text-[var(--aw-node-text-muted)]">
          {"\u2192"}
        </span>
        <code className="font-mono text-[var(--aw-branch-edge)]">
          prev[{b.index}]
        </code>
        {b.nodeId && (
          <>
            <span className="mx-1 text-[var(--aw-node-text-muted)]">
              {"\u2192"}
            </span>
            <span className="font-medium truncate text-text-primary dark:text-text-primary-dark">
              {b.nodeId}
            </span>
          </>
        )}
        {b.statusCode && b.statusCode !== "N/A" && (
          <span className="ml-1 text-[var(--aw-node-text-muted)]">
            ({b.statusCode})
          </span>
        )}
      </div>
    ))}
    <div className="text-xs italic mt-1 text-[var(--aw-node-text-muted)]">
      Example:{" "}
      <code className="font-mono text-[var(--aw-branch-edge)]">
        {"{{prev[0].response.body.id}}"}
      </code>
    </div>
  </div>
);

type MergeStrategy = "all" | "any" | "first" | "conditional";

interface StrategyMeta {
  icon: React.ReactNode;
  desc: string;
}

const MergeNode = ({ id, data, selected = false }: MergeNodeProps) => {
  const { label, config = {}, executionStatus, executionResult } = data;
  const mergeStrategy = config.mergeStrategy ?? "all";
  const status = executionStatus ?? data.status ?? "idle";
  const result = executionResult ?? data.result;

  const icon = useMemo(() => <GitMerge className="w-4 h-4" />, []);

  const typeChip = useMemo(() => {
    if (!(data.incomingBranchCount && data.incomingBranchCount > 1))
      return null;

    return (
      <span
        className="flex-shrink-0 text-[11px] px-1.5 py-0.5 rounded-node-chip font-mono bg-[color-mix(in_srgb,var(--aw-branch-edge)_12%,transparent)] text-[var(--aw-branch-edge)]"
        title={`Merging ${data.incomingBranchCount} branches`}
      >
        &larr; {data.incomingBranchCount}x
      </span>
    );
  }, [data.incomingBranchCount]);

  const strategyMeta: Record<MergeStrategy, StrategyMeta> = {
    all: {
      icon: (
        <Clock className="w-3.5 h-3.5 flex-shrink-0 text-text-secondary dark:text-text-secondary-dark" />
      ),
      desc: "Waits for all branches",
    },
    any: {
      icon: (
        <Sparkles className="w-3.5 h-3.5 flex-shrink-0 text-text-secondary dark:text-text-secondary-dark" />
      ),
      desc: "Continues when any completes",
    },
    first: {
      icon: (
        <ArrowRight className="w-3.5 h-3.5 flex-shrink-0 text-text-secondary dark:text-text-secondary-dark" />
      ),
      desc: "Uses first completed branch",
    },
    conditional: {
      icon: (
        <Filter className="w-3.5 h-3.5 flex-shrink-0 text-text-secondary dark:text-text-secondary-dark" />
      ),
      desc: "Merges matching conditions",
    },
  };

  const { icon: stratIcon, desc: stratDesc } =
    strategyMeta[mergeStrategy as MergeStrategy] ?? strategyMeta.all;

  const branchCount = data.incomingBranchCount ?? 0;
  const mergedCount = result?.branchCount;
  const branchWord = (count: number) => (count === 1 ? "branch" : "branches");

  return (
    <BaseNode
      title={label ?? "Merge"}
      icon={icon}
      tileHue="var(--aw-branch-edge)"
      status={status}
      selected={selected}
      nodeId={id}
      presetNodeType="merge"
      handleLeft={{ type: "target" }}
      handleRight={{ type: "source" }}
      collapsible={true}
      defaultExpanded={false}
      typeChip={typeChip}
      restLine={{ operation: stratDesc }}
      activityLine={{
        operation: "waiting on",
        argument: `${branchCount} ${branchWord(branchCount)}`,
      }}
      {...(mergedCount !== undefined && {
        resultSummary: {
          operation: "merged",
          argument: `${mergedCount} ${branchWord(mergedCount)}`,
        },
      })}
      metrics={[
        {
          label: "branches",
          value:
            mergedCount !== undefined
              ? `${mergedCount} ${branchWord(mergedCount)}`
              : null,
        },
        // The merge result records when it merged, not how long it waited, so
        // this cell holds the row's shape rather than inventing a duration.
        { label: "duration", value: null },
      ]}
      progress={status === "running" ? "indeterminate" : null}
      className="min-w-[200px]"
    >
      {({ isExpanded }) => (
        <div className={isExpanded ? "p-3 space-y-2" : ""}>
          {isExpanded && (
            <div className="flex items-center gap-1.5 text-xs italic text-text-secondary dark:text-text-secondary-dark">
              {stratIcon}
              <span>{stratDesc}</span>
            </div>
          )}

          {isExpanded && (
            <div className="space-y-2 pt-1 border-t border-border dark:border-border-dark">
              <div className="text-xs">
                <label
                  htmlFor="merge-strategy"
                  className="block mb-0.5 font-medium text-xs text-text-secondary dark:text-text-secondary-dark"
                >
                  Merge Strategy
                </label>
                <select
                  id="merge-strategy"
                  value={mergeStrategy}
                  onChange={() => {}}
                  aria-readonly="true"
                  className="w-full px-1.5 py-0.5 text-xs border rounded-node-ctl cursor-default border-border dark:border-border-dark bg-surface-raised dark:bg-surface-dark-raised text-text-primary dark:text-text-primary-dark"
                >
                  <option value="all">Wait for All (AND)</option>
                  <option value="any">Wait for Any (OR)</option>
                  <option value="first">First Completes</option>
                  <option value="conditional">Conditional Merge</option>
                </select>
                <OpenNodeEditorButton
                  nodeId={id}
                  label="Change strategy"
                  ariaLabel="Open merge node editor to change strategy"
                  className="mt-1"
                />
              </div>

              {result && (
                <div
                  className="text-xs p-2 rounded-node-ctl border border-border dark:border-border-dark bg-surface-raised dark:bg-surface-dark-raised text-text-secondary dark:text-text-secondary-dark"
                >
                  <div className="font-medium mb-1 flex items-center gap-2">
                    <CheckCircle className="w-4 h-4 text-[var(--aw-status-success)]" />
                    <span>
                      {result.mergeStrategy === "conditional"
                        ? "Conditions Passed:"
                        : "Merged Branches:"}
                    </span>
                  </div>
                  {result.branchCount !== undefined && (
                    <div className="flex items-center gap-2">
                      <SquareCheckBig className="w-4 h-4 text-[var(--aw-status-info)]" />
                      <span>
                        {result.branchCount} branch(es){" "}
                        {result.mergeStrategy === "conditional"
                          ? "passed"
                          : "merged"}
                      </span>
                    </div>
                  )}

                  {result.warning && (
                    <div className="mt-2 p-1.5 border rounded-node-ctl bg-[var(--aw-status-warning)]/5 border-status-warning/30">
                      <div className="text-xs flex items-center gap-1 text-[var(--aw-status-warning)]">
                        <AlertTriangle className="w-3 h-3 flex-shrink-0" />
                        <span className="font-semibold">Strategy Warning:</span>
                      </div>
                      <div className="text-xs mt-0.5 text-[var(--aw-status-warning)]">
                        {result.warning}
                      </div>
                    </div>
                  )}

                  {result.branches && result.branches.length > 0 && (
                    <BranchMapping branches={result.branches} />
                  )}

                  {result.mergedAt && (
                    <div className="text-xs mt-2 text-[var(--aw-node-text-muted)]">
                      {new Date(result.mergedAt).toLocaleTimeString()}
                    </div>
                  )}
                </div>
              )}

              {data.incomingBranchCount &&
                data.incomingBranchCount > 1 &&
                !result && (
                  <div className="text-xs rounded-node-ctl border border-border dark:border-border-dark bg-surface-overlay dark:bg-surface-dark-overlay p-2">
                    <div className="font-semibold mb-1 text-xs flex items-center gap-1 text-[var(--aw-branch-edge)]">
                      <GitMerge className="w-3 h-3" />
                      <span>Branch &rarr; Variable Mapping:</span>
                    </div>
                    {data.incomingBranches &&
                    data.incomingBranches.length > 0 ? (
                      <BranchMapping branches={data.incomingBranches} />
                    ) : (
                      <div className="text-xs space-y-0.5 text-text-secondary dark:text-text-secondary-dark">
                        <div>
                          This node merges {data.incomingBranchCount} branches
                        </div>
                        <div className="italic mt-1 text-[var(--aw-node-text-muted)]">
                          Use{" "}
                          <code className="font-mono text-[var(--aw-branch-edge)]">
                            {"{{prev[0]}}"}
                          </code>
                          ,{" "}
                          <code className="font-mono text-[var(--aw-branch-edge)]">
                            {"{{prev[1]}}"}
                          </code>
                          , etc.
                        </div>
                      </div>
                    )}
                  </div>
                )}
            </div>
          )}
        </div>
      )}
    </BaseNode>
  );
};

export default memo(MergeNode);
