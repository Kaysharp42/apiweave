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
import type { MergeNodeProps, BranchInfo } from "../../types/MergeNodeProps";

const BranchMapping = ({ branches }: { branches: BranchInfo[] }) => (
  <div className="mt-1 space-y-1">
    {branches.map((b) => (
      <div
        key={b.index}
        className="text-xs p-1.5 rounded-sm border"
        style={{
          backgroundColor: "var(--aw-surface-raised)",
          borderColor: "var(--aw-border)",
        }}
      >
        <span className="font-medium truncate text-text-primary dark:text-text-primary-dark">
          {b.edgeLabel ?? b.label ?? `Branch ${b.index}`}
        </span>
        <span className="mx-1 text-text-muted dark:text-text-muted-dark">
          {"\u2192"}
        </span>
        <code className="font-mono" style={{ color: "var(--aw-branch-edge)" }}>
          prev[{b.index}]
        </code>
        {b.nodeId && (
          <>
            <span className="mx-1 text-text-muted dark:text-text-muted-dark">
              {"\u2192"}
            </span>
            <span className="font-medium truncate text-text-primary dark:text-text-primary-dark">
              {b.nodeId}
            </span>
          </>
        )}
        {b.statusCode && b.statusCode !== "N/A" && (
          <span className="ml-1 text-text-muted dark:text-text-muted-dark">
            ({b.statusCode})
          </span>
        )}
      </div>
    ))}
    <div className="text-xs italic mt-1 text-text-muted dark:text-text-muted-dark">
      Example:{" "}
      <code className="font-mono" style={{ color: "var(--aw-branch-edge)" }}>
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

  const icon = useMemo(
    () => (
      <GitMerge className="w-4 h-4 text-text-secondary dark:text-text-secondary-dark" />
    ),
    [],
  );

  const titleExtra = useMemo(() => {
    if (!(data.incomingBranchCount && data.incomingBranchCount > 1))
      return null;

    return (
      <span
        className="text-xs px-1.5 py-0.5 rounded-sm font-mono border border-border dark:border-border-dark bg-surface-overlay dark:bg-surface-dark-overlay text-text-secondary dark:text-text-secondary-dark"
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

  return (
    <BaseNode
      title={label ?? "Merge"}
      icon={icon}
      status={status}
      selected={selected}
      nodeId={id}
      handleLeft={{ type: "target" }}
      handleRight={{ type: "source" }}
      collapsible={true}
      defaultExpanded={false}
      statusBadgeText={
        status !== "idle"
          ? status.charAt(0).toUpperCase() + status.slice(1)
          : ""
      }
      titleExtra={titleExtra}
      className="min-w-[200px]"
    >
      {({ isExpanded }) => (
        <div className="p-3 space-y-2">
          <div className="flex items-center gap-1.5 text-xs italic text-text-secondary dark:text-text-secondary-dark">
            {stratIcon}
            <span>{stratDesc}</span>
          </div>

          {!isExpanded && result && (
            <div className="text-xs flex items-center gap-1 text-text-muted dark:text-text-muted-dark">
              <CheckCircle
                className="w-3 h-3"
                style={{ color: "var(--aw-status-success)" }}
              />
              <span>
                {result.branchCount ?? 0} branch
                {result.branchCount !== 1 ? "es" : ""} merged
              </span>
            </div>
          )}

          {isExpanded && (
            <div
              className="space-y-2 pt-1 border-t"
              style={{ borderColor: "var(--aw-border)" }}
            >
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
                  className="w-full px-1.5 py-0.5 text-xs border rounded-sm cursor-default"
                  style={{
                    borderColor: "var(--aw-border)",
                    backgroundColor: "var(--aw-surface-raised)",
                    color: "var(--aw-text-primary)",
                  }}
                >
                  <option value="all">Wait for All (AND)</option>
                  <option value="any">Wait for Any (OR)</option>
                  <option value="first">First Completes</option>
                  <option value="conditional">Conditional Merge</option>
                </select>
                <button
                  type="button"
                  onClick={() => {
                    const node = document.querySelector(
                      `[data-id="${id}"]`,
                    ) as HTMLElement | null;
                    node?.dispatchEvent(
                      new MouseEvent("dblclick", {
                        bubbles: true,
                        cancelable: true,
                        view: window,
                      }),
                    );
                  }}
                  className="mt-1 nodrag cursor-pointer focus-visible:outline-2 focus-visible:outline-[var(--aw-primary)] focus-visible:outline-offset-[var(--aw-focus-ring-offset)]"
                  style={{ color: "var(--aw-primary)" }}
                  aria-label="Open merge node editor to change strategy"
                >
                  Change strategy
                </button>
              </div>

              {result && (
                <div
                  className="text-xs p-2 rounded-sm border"
                  style={{
                    backgroundColor: "var(--aw-surface-raised)",
                    borderColor: "var(--aw-border)",
                    color: "var(--aw-text-secondary)",
                  }}
                >
                  <div className="font-medium mb-1 flex items-center gap-2">
                    <CheckCircle
                      className="w-4 h-4"
                      style={{ color: "var(--aw-status-success)" }}
                    />
                    <span>
                      {result.mergeStrategy === "conditional"
                        ? "Conditions Passed:"
                        : "Merged Branches:"}
                    </span>
                  </div>
                  {result.branchCount !== undefined && (
                    <div className="flex items-center gap-2">
                      <SquareCheckBig
                        className="w-4 h-4"
                        style={{ color: "var(--aw-status-info)" }}
                      />
                      <span>
                        {result.branchCount} branch(es){" "}
                        {result.mergeStrategy === "conditional"
                          ? "passed"
                          : "merged"}
                      </span>
                    </div>
                  )}

                  {result.warning && (
                    <div className="mt-2 p-1.5 border rounded-sm bg-[var(--aw-status-warning)]/5 border-status-warning/30">
                      <div
                        className="text-xs flex items-center gap-1"
                        style={{ color: "var(--aw-status-warning)" }}
                      >
                        <AlertTriangle className="w-3 h-3 flex-shrink-0" />
                        <span className="font-semibold">Strategy Warning:</span>
                      </div>
                      <div
                        className="text-xs mt-0.5"
                        style={{ color: "var(--aw-status-warning)" }}
                      >
                        {result.warning}
                      </div>
                    </div>
                  )}

                  {result.branches && result.branches.length > 0 && (
                    <BranchMapping branches={result.branches} />
                  )}

                  {result.mergedAt && (
                    <div className="text-xs mt-2 text-text-muted dark:text-text-muted-dark">
                      {new Date(result.mergedAt).toLocaleTimeString()}
                    </div>
                  )}
                </div>
              )}

              {data.incomingBranchCount &&
                data.incomingBranchCount > 1 &&
                !result && (
                  <div className="text-xs rounded-sm border border-border dark:border-border-dark bg-surface-overlay dark:bg-surface-dark-overlay p-2">
                    <div
                      className="font-semibold mb-1 text-xs flex items-center gap-1"
                      style={{ color: "var(--aw-branch-edge)" }}
                    >
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
                        <div className="italic mt-1 text-text-muted dark:text-text-muted-dark">
                          Use{" "}
                          <code
                            className="font-mono"
                            style={{ color: "var(--aw-branch-edge)" }}
                          >
                            {"{{prev[0]}}"}
                          </code>
                          ,{" "}
                          <code
                            className="font-mono"
                            style={{ color: "var(--aw-branch-edge)" }}
                          >
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
