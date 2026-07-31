import { memo, useMemo } from "react";
import { Workflow, CheckCircle, XCircle, ArrowRightLeft } from "lucide-react";
import { BaseNode } from "../atoms/flow/BaseNode";
import type { WorkflowCallNodeProps } from "../../types/WorkflowCallNodeProps";

const CallWorkflowNode = ({ id, data, selected = false }: WorkflowCallNodeProps) => {
  const { label, config = {}, executionStatus, executionResult } = data;
  const status = executionStatus ?? data.status ?? "idle";
  const result = executionResult ?? data.result;

  const icon = useMemo(
    () => (
      <Workflow className="w-4 h-4 text-text-secondary dark:text-text-secondary-dark" />
    ),
    [],
  );

  const inputCount = Object.keys(config.inputMapping ?? {}).length;
  const outputCount = Object.keys(config.outputMapping ?? {}).length;

  return (
    <BaseNode
      title={label ?? "Call Workflow"}
      icon={icon}
      status={status}
      selected={selected}
      nodeId={id}
      handleLeft={{ type: "target" }}
      handleRight={{ type: "source" }}
      collapsible={true}
      defaultExpanded={false}
      className="min-w-[200px]"
    >
      {({ isExpanded }) => (
        <div className="p-3 space-y-2">
          {config.targetWorkflowId ? (
            <div className="text-xs italic text-text-secondary dark:text-text-secondary-dark truncate">
              Calls: {config.targetWorkflowName ?? config.targetWorkflowId}
            </div>
          ) : (
            <div className="text-xs italic text-text-muted dark:text-text-muted-dark">
              No target workflow configured
            </div>
          )}

          {(inputCount > 0 || outputCount > 0) && (
            <div className="flex items-center gap-1.5 text-xs text-text-muted dark:text-text-muted-dark">
              <ArrowRightLeft className="w-3 h-3 flex-shrink-0" />
              <span>
                {inputCount} in &middot; {outputCount} out
              </span>
            </div>
          )}

          {!isExpanded && result?.subWorkflow && (
            <div className="text-xs flex items-center gap-1 text-text-muted dark:text-text-muted-dark">
              {result.subWorkflow.status === "passed" ? (
                <CheckCircle className="w-3 h-3" style={{ color: "var(--aw-status-success)" }} />
              ) : (
                <XCircle className="w-3 h-3" style={{ color: "var(--aw-status-error)" }} />
              )}
              <span>{result.message}</span>
            </div>
          )}

          {isExpanded && (
            <div
              className="space-y-2 pt-1 border-t"
              style={{ borderColor: "var(--aw-border)" }}
            >
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
                className="nodrag cursor-pointer focus-visible:outline-2 focus-visible:outline-[var(--aw-primary)] focus-visible:outline-offset-[var(--aw-focus-ring-offset)]"
                style={{ color: "var(--aw-primary)" }}
                aria-label="Open Call Workflow editor to change the target"
              >
                {config.targetWorkflowId ? "Change target" : "Choose target workflow"}
              </button>

              {result?.subWorkflow && (
                <div
                  className="text-xs p-2 rounded-sm border"
                  style={{
                    backgroundColor: "var(--aw-surface-raised)",
                    borderColor: "var(--aw-border)",
                    color: "var(--aw-text-secondary)",
                  }}
                >
                  <div className="font-medium mb-1 flex items-center gap-2">
                    {result.subWorkflow.status === "passed" ? (
                      <CheckCircle className="w-4 h-4" style={{ color: "var(--aw-status-success)" }} />
                    ) : (
                      <XCircle className="w-4 h-4" style={{ color: "var(--aw-status-error)" }} />
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
