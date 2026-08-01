import { memo, useMemo } from "react";
import { Workflow, CheckCircle, XCircle, ArrowRightLeft } from "lucide-react";
import { BaseNode } from "../atoms/flow/BaseNode";
import { OpenNodeEditorButton } from "../atoms/flow/OpenNodeEditorButton";
import type { WorkflowCallNodeProps } from "../../types/WorkflowCallNodeProps";

type CallResult = NonNullable<WorkflowCallNodeProps["data"]["result"]>;
type SubWorkflow = NonNullable<CallResult["subWorkflow"]>;

interface SubWorkflowSummaryProps {
  result: CallResult;
}

/**
 * What the sub-workflow run reported, shown in the expanded body.
 *
 * Its own component so the node function stays a description of the node and
 * not a rendering of the run: every branch below was previously counted
 * against `CallWorkflowNode`'s complexity budget.
 */
const SubWorkflowSummary = ({ result }: SubWorkflowSummaryProps) => {
  const subWorkflow = result.subWorkflow;
  if (!subWorkflow) return null;

  return (
    <div className="text-xs p-2 rounded-node-ctl border border-border dark:border-border-dark bg-surface-raised dark:bg-surface-dark-raised text-text-secondary dark:text-text-secondary-dark">
      <div className="font-medium mb-1 flex items-center gap-2">
        {subWorkflow.status === "passed" ? (
          <CheckCircle className="w-4 h-4 text-[var(--aw-status-success)]" />
        ) : (
          <XCircle className="w-4 h-4 text-[var(--aw-status-error)]" />
        )}
        <span>{result.message}</span>
      </div>
      <div>
        {subWorkflow.nodeCount} node(s)
        {subWorkflow.failedNodeCount > 0 &&
          `, ${subWorkflow.failedNodeCount} failed`}
      </div>
      {subWorkflow.outputVariableNames.length > 0 && (
        <div className="mt-1 text-[var(--aw-node-text-muted)]">
          Mapped: {subWorkflow.outputVariableNames.join(", ")}
        </div>
      )}
    </div>
  );
};

interface MappingChipProps {
  inputCount: number;
  outputCount: number;
}

/** `2/1` — how many variables go in and come back out. Absent when neither. */
const MappingChip = ({ inputCount, outputCount }: MappingChipProps) => {
  if (inputCount === 0 && outputCount === 0) return null;

  const plural = (count: number, noun: string) =>
    `${count} ${noun}${count === 1 ? "" : "s"}`;

  return (
    <span
      className="flex-shrink-0 flex items-center gap-1 text-[11px] font-mono px-1.5 py-0.5 rounded-node-chip bg-[color-mix(in_srgb,var(--aw-status-info)_12%,transparent)] text-[var(--aw-status-info)]"
      title={`${plural(inputCount, "input")}, ${plural(outputCount, "output")}`}
    >
      <ArrowRightLeft className="w-2.5 h-2.5" aria-hidden="true" />
      {inputCount}/{outputCount}
    </span>
  );
};

/**
 * The run-strip copy for a finished call: `12 nodes` / `12 nodes · 3 failed`.
 *
 * Kept out of the component so the node function stays a description of the
 * node rather than a pile of formatting branches.
 */
function summaryFor(
  subWorkflow: SubWorkflow | undefined,
): { operation: string; argument?: string } | undefined {
  if (!subWorkflow) return undefined;

  const operation = `${subWorkflow.nodeCount} ${subWorkflow.nodeCount === 1 ? "node" : "nodes"}`;
  if (subWorkflow.failedNodeCount > 0) {
    return { operation, argument: `${subWorkflow.failedNodeCount} failed` };
  }
  return { operation };
}

/** The metrics row holds its shape: a missing field renders `—`, never gone. */
function metricsFor(subWorkflow: SubWorkflow | undefined) {
  return [
    {
      label: "nodes",
      value: subWorkflow ? `${subWorkflow.nodeCount} nodes` : null,
    },
    // The sub-workflow summary carries counts, not a wall-clock duration.
    { label: "duration", value: null },
  ];
}

/**
 * Which run to draw. `executionStatus`/`executionResult` are what the canvas
 * writes during a run; the bare `status`/`result` are the older shape still
 * present on stored graphs, so both are read and the newer one wins.
 */
function resolveRun(data: WorkflowCallNodeProps["data"]) {
  const result = data.executionResult ?? data.result;
  return {
    status: data.executionStatus ?? data.status ?? "idle",
    result,
    subWorkflow: result?.subWorkflow,
  };
}

/** The rest and activity lines, which both hang off the target's name. */
function describeTarget(targetName: string | null | undefined) {
  if (!targetName) {
    return {
      restLine: { operation: "no target workflow" },
      activityLine: { operation: "running" },
    };
  }
  return {
    restLine: { operation: "calls", argument: targetName },
    activityLine: { operation: "running", argument: targetName },
  };
}

interface CallWorkflowBodyProps {
  nodeId: string;
  hasTarget: boolean;
  result: CallResult | undefined;
}

/** The expanded body: retarget the call, and what the last call reported. */
const CallWorkflowBody = ({
  nodeId,
  hasTarget,
  result,
}: CallWorkflowBodyProps) => (
  <div className="space-y-2 pt-1 border-t border-border dark:border-border-dark">
    <OpenNodeEditorButton
      nodeId={nodeId}
      label={hasTarget ? "Change target" : "Choose target workflow"}
      ariaLabel="Open Call Workflow editor to change the target"
    />
    {result && <SubWorkflowSummary result={result} />}
  </div>
);

const CallWorkflowNode = ({ id, data, selected = false }: WorkflowCallNodeProps) => {
  const { label, config = {} } = data;
  const { status, result, subWorkflow } = resolveRun(data);

  const icon = useMemo(() => <Workflow className="w-4 h-4" />, []);

  const inputCount = Object.keys(config.inputMapping ?? {}).length;
  const outputCount = Object.keys(config.outputMapping ?? {}).length;

  const { restLine, activityLine } = describeTarget(
    config.targetWorkflowName ?? config.targetWorkflowId,
  );
  const resultSummary = summaryFor(subWorkflow);

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
      typeChip={
        <MappingChip inputCount={inputCount} outputCount={outputCount} />
      }
      restLine={restLine}
      activityLine={activityLine}
      {...(resultSummary && { resultSummary })}
      metrics={metricsFor(subWorkflow)}
      progress={status === "running" ? "indeterminate" : null}
      className="min-w-[200px]"
    >
      {({ isExpanded }) =>
        isExpanded ? (
          <div className="p-3 space-y-2">
            <CallWorkflowBody
              nodeId={id}
              hasTarget={Boolean(config.targetWorkflowId)}
              result={result}
            />
          </div>
        ) : null
      }
    </BaseNode>
  );
};

export default memo(CallWorkflowNode);
