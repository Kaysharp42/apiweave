import { useEffect, useState } from "react";
import { Info, X } from "lucide-react";
import { Button } from "../atoms/Button";
import { IconButton } from "../atoms/IconButton";
import { Input } from "../atoms/Input";
import { Card } from "../molecules/Card";
import { FormField } from "../molecules/FormField";
import { apiweave } from "../../utils/apiweaveClient";
import type { Workflow } from "../../types/Workflow";
import type {
  NodeModalWorkflowCallConfig,
  WorkflowCallConfigPanelProps,
} from "../../types";

function InfoCardIcon({ className }: { className?: string }) {
  return <Info className={className} />;
}

export function WorkflowCallConfigPanel({
  initialConfig,
  workingDataRef,
  workspaceId,
  currentWorkflowId,
}: WorkflowCallConfigPanelProps) {
  const [targetWorkflowId, setTargetWorkflowId] = useState<string | null>(
    initialConfig.targetWorkflowId ?? null,
  );
  const [targetWorkflowName, setTargetWorkflowName] = useState<string | null>(
    initialConfig.targetWorkflowName ?? null,
  );
  const [inputMapping, setInputMapping] = useState<Record<string, string>>(
    initialConfig.inputMapping ?? {},
  );
  const [outputMapping, setOutputMapping] = useState<Record<string, string>>(
    initialConfig.outputMapping ?? {},
  );
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [newInputKey, setNewInputKey] = useState("");
  const [newInputExpr, setNewInputExpr] = useState("");
  const [newOutputKey, setNewOutputKey] = useState("");
  const [newOutputExpr, setNewOutputExpr] = useState("");

  useEffect(() => {
    let cancelled = false;
    if (!workspaceId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    apiweave.workflows
      .list(workspaceId, true)
      .then((result) => {
        if (cancelled) return;
        setWorkflows(
          result.items.filter((w) => w.workflowId !== currentWorkflowId),
        );
        setLoadError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setLoadError(
          err instanceof Error ? err.message : "Failed to load workflows",
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceId, currentWorkflowId]);

  function writeConfig(
    nextTargetId: string | null = targetWorkflowId,
    nextTargetName: string | null = targetWorkflowName,
    nextInputMapping: Record<string, string> = inputMapping,
    nextOutputMapping: Record<string, string> = outputMapping,
  ) {
    const nextConfig: NodeModalWorkflowCallConfig = {
      targetWorkflowId: nextTargetId,
      targetWorkflowName: nextTargetName,
      inputMapping: nextInputMapping,
      outputMapping: nextOutputMapping,
    };
    workingDataRef.current = {
      ...workingDataRef.current,
      config: { ...nextConfig },
    };
  }

  function handleTargetChange(workflowId: string) {
    const selected = workflows.find((w) => w.workflowId === workflowId);
    const nextId = workflowId || null;
    const nextName = selected?.name ?? null;
    setTargetWorkflowId(nextId);
    setTargetWorkflowName(nextName);
    writeConfig(nextId, nextName);
  }

  function addInputMapping() {
    const key = newInputKey.trim();
    if (!key || !newInputExpr) return;
    const next = { ...inputMapping, [key]: newInputExpr };
    setInputMapping(next);
    writeConfig(undefined, undefined, next);
    setNewInputKey("");
    setNewInputExpr("");
  }

  function removeInputMapping(key: string) {
    const next = { ...inputMapping };
    delete next[key];
    setInputMapping(next);
    writeConfig(undefined, undefined, next);
  }

  function addOutputMapping() {
    const key = newOutputKey.trim();
    if (!key || !newOutputExpr) return;
    const next = { ...outputMapping, [key]: newOutputExpr };
    setOutputMapping(next);
    writeConfig(undefined, undefined, undefined, next);
    setNewOutputKey("");
    setNewOutputExpr("");
  }

  function removeOutputMapping(key: string) {
    const next = { ...outputMapping };
    delete next[key];
    setOutputMapping(next);
    writeConfig(undefined, undefined, undefined, next);
  }

  return (
    <div className="space-y-4">
      <Card title="Target workflow" icon={InfoCardIcon}>
        {loadError && (
          <p className="text-xs text-status-error dark:text-status-error mb-2">
            {loadError}
          </p>
        )}
        <FormField
          label="Workflow"
          hint="Runs this workflow to completion as a single step, in-process."
        >
          <select
            value={targetWorkflowId ?? ""}
            onChange={(e) => handleTargetChange(e.target.value)}
            disabled={loading}
            className="w-full px-3 py-2 border border-border dark:border-border-dark rounded bg-surface-raised dark:bg-surface-dark-raised text-text-primary dark:text-text-primary-dark"
          >
            <option value="">
              {loading ? "Loading workflows..." : "Select a workflow"}
            </option>
            {workflows.map((w) => (
              <option key={w.workflowId} value={w.workflowId}>
                {w.name}
              </option>
            ))}
          </select>
        </FormField>
      </Card>

      <Card title="Input mapping" icon={InfoCardIcon}>
        <p className="text-xs text-text-secondary dark:text-text-secondary-dark mb-3">
          Resolved in this workflow&apos;s context, then written into the
          target workflow&apos;s variables before it runs.
        </p>
        <div className="space-y-2 mb-3">
          {Object.entries(inputMapping).map(([key, expr]) => (
            <div
              key={key}
              className="flex items-center gap-2 p-2 bg-surface-overlay dark:bg-surface-dark-overlay rounded"
            >
              <span className="font-mono text-sm text-text-secondary dark:text-text-secondary-dark flex-shrink-0">
                {key}
              </span>
              <span className="text-text-muted dark:text-text-muted-dark">
                =
              </span>
              <span className="font-mono text-sm text-text-primary dark:text-text-primary-dark flex-1 truncate">
                {expr}
              </span>
              <IconButton
                onClick={() => removeInputMapping(key)}
                variant="error"
                size="xs"
                tooltip="Remove mapping"
              >
                <X className="w-4 h-4" />
              </IconButton>
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          <Input
            value={newInputKey}
            onChange={(e) => setNewInputKey(e.target.value)}
            size="sm"
            className="flex-1"
            placeholder="target variable"
          />
          <Input
            value={newInputExpr}
            onChange={(e) => setNewInputExpr(e.target.value)}
            size="sm"
            className="flex-1 font-mono"
            placeholder="{{variables.userId}}"
          />
          <Button variant="ghost" size="sm" onClick={addInputMapping}>
            Add
          </Button>
        </div>
      </Card>

      <Card title="Output mapping" icon={InfoCardIcon}>
        <p className="text-xs text-text-secondary dark:text-text-secondary-dark mb-3">
          Read from the target workflow&apos;s variables once it completes,
          then written into this workflow&apos;s variables.
        </p>
        <div className="space-y-2 mb-3">
          {Object.entries(outputMapping).map(([key, subVar]) => (
            <div
              key={key}
              className="flex items-center gap-2 p-2 bg-surface-overlay dark:bg-surface-dark-overlay rounded"
            >
              <span className="font-mono text-sm text-text-secondary dark:text-text-secondary-dark flex-shrink-0">
                {key}
              </span>
              <span className="text-text-muted dark:text-text-muted-dark">
                =
              </span>
              <span className="font-mono text-sm text-text-primary dark:text-text-primary-dark flex-1 truncate">
                {subVar}
              </span>
              <IconButton
                onClick={() => removeOutputMapping(key)}
                variant="error"
                size="xs"
                tooltip="Remove mapping"
              >
                <X className="w-4 h-4" />
              </IconButton>
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          <Input
            value={newOutputKey}
            onChange={(e) => setNewOutputKey(e.target.value)}
            size="sm"
            className="flex-1"
            placeholder="caller variable"
          />
          <Input
            value={newOutputExpr}
            onChange={(e) => setNewOutputExpr(e.target.value)}
            size="sm"
            className="flex-1 font-mono"
            placeholder="target's variable name"
          />
          <Button variant="ghost" size="sm" onClick={addOutputMapping}>
            Add
          </Button>
        </div>
      </Card>
    </div>
  );
}
