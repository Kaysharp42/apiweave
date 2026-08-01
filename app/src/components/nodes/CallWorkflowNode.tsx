import { memo, useMemo } from "react";
import { Workflow, CheckCircle, XCircle, ArrowRightLeft } from "lucide-react";
import { BaseNode } from "../atoms/flow/BaseNode";
import type { WorkflowCallNodeProps } from "../../types/WorkflowCallNodeProps";

const CallWorkflowNode = ({ id, data, selected = false }: WorkflowCallNodeProps) => {
  const { label, config = {}, executionStatus, executionResult } = data;
  const status = executionStatus ?? data.status ?? "idle";
  const result = executionResult ?? data.result;

  const icon = useMemo(() => <Workflow className="w-4 h-4" />, []);

  const inputCount = Object.keys(config.inputMapping ?? {}).length;
  const outputCount = Object.keys(config.outputMapping ?? {}).length;

  const targetName = config.targetWorkflowName ?? config.targetWorkflowId;

  const typeChip = useMemo(() => {
    if (inputCount === 0 && outputCount === 0) return null;

    return (
      <span
        className="flex-shrink-0 flex items-center gap-1 text-[11px] font-mono px-1.5 py-0.5 rounded-node-chip bg-[color-mix(in_srgb,var(--aw-status-info)_12%,transparent)] text-[var(--aw-status-info)]"
        title={`${inputCount} input${inputCount === 1 ? "" : "s"}, ${outputCount} output${outputCount === 1 ? "" : "s"}`}
      >
        <ArrowRightLeft className="w-2.5 h-2.5" aria-hidden="true" />
        {inputCount}/{outputCount}
      </span>
    );
  }, [inputCount, outputCount]);

  const subWorkflow = result?.subWorkflow;

  return (
    <BaseNode
      title={label ?? "Call Workflow"}
      icon={icon}
      tileHue="var(--aw-status-info)"
      status={status}
      selected={selected}
      nodeId={id}
      presetNodeType="workflow"
      handleLeft={{ type: "target" }}
      handleRight={{ type: "source" }}
      collapsible={true}
      defaultExpanded={false}
      typeChip={typeChip}
      restLine={
        targetName
          ? { operation: "calls", argument: targetName }
          : { operation: "no target workflow" }
      }
      activityLine={{
        operation: "running",
        ...(targetName && { argument: targetName }),
      }}
      {...(subWorkflow && {
        resultSummary: {
          operation: `${subWorkflow.nodeCount} ${subWorkflow.nodeCount === 1 ? "node" : "nodes"}`,
          ...(subWorkflow.failedNodeCount > 0 && {
            argument: `${subWorkflow.failedNodeCount} failed`,
          }),
        },
      })}
      metrics={[
        {
          label: "nodes",
          value: subWorkflow ? `${subWorkflow.nodeCount} nodes` : null,
        },
        // The sub-workflow summary carries counts, not a wall-clock duration.
        { label: "duration", value: null },
      ]}
      progress={status === "running" ? "indeterminate" : null}
      className="min-w-[200px]"
    >
      {({ isExpanded }) => (
        <div className={isExpanded ? "p-3 space-y-2" : ""}>
          {isExpanded && (
            <div className="space-y-2 pt-1 border-t border-border dark:border-border-dark">
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
                className="nodrag cursor-pointer text-[var(--aw-primary)] focus-visible:outline-2 focus-visible:outline-[var(--aw-primary)] focus-visible:outline-offset-[var(--aw-focus-ring-offset)]"
                aria-label="Open Call Workflow editor to change the target"
              >
                {config.targetWorkflowId ? "Change target" : "Choose target workflow"}
              </button>

              {result?.subWorkflow && (
                <div className="text-xs p-2 rounded-node-ctl border border-border dark:border-border-dark bg-surface-raised dark:bg-surface-dark-raised text-text-secondary dark:text-text-secondary-dark">
                  <div className="font-medium mb-1 flex items-center gap-2">
                    {result.subWorkflow.status === "passed" ? (
                      <CheckCircle className="w-4 h-4 text-[var(--aw-status-success)]" />
                    ) : (
                      <XCircle className="w-4 h-4 text-[var(--aw-status-error)]" />
                    )}
                    <span>{result.message}</span>
                  </div>
                  <div>
                    {result.subWorkflow.nodeCount} node(s)
                    {result.subWorkflow.failedNodeCount > 0 &&
                      `, ${result.subWorkflow.failedNodeCount} failed`}
                  </div>
                  {result.subWorkflow.outputVariableNames.length > 0 && (
                    <div className="mt-1 text-text-muted dark:text-text-muted-dark">
                      Mapped: {result.subWorkflow.outputVariableNames.join(", ")}
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

export default memo(CallWorkflowNode);
