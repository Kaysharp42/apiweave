import { useEffect, useState } from "react";
import { Info, X } from "lucide-react";
import { Button } from "../atoms/Button";
import { IconButton } from "../atoms/IconButton";
import { Input } from "../atoms/Input";
import { Select } from "../atoms/Select";
import { Toggle } from "../atoms/Toggle";
import { TemplateInput } from "../molecules/TemplateAutocomplete";
import { Card } from "../molecules/Card";
import { FormField } from "../molecules/FormField";
import { apiweave } from "../../utils/apiweaveClient";
import { WORKFLOW_CALL_FOR_EACH_MAX_CONCURRENCY } from "@shared/zod-schemas/WorkflowCallForEachSchema";
import type { Workflow } from "../../types/Workflow";
import type { WorkflowCallForEach } from "../../types";
import type {
  NodeModalWorkflowCallConfig,
  WorkflowCallConfigPanelProps,
} from "../../types";

function InfoCardIcon({ className }: { className?: string }) {
  return <Info className={className} />;
}

function MappingCard({
  title,
  description,
  mapping,
  onRemove,
  newKey,
  onNewKeyChange,
  keyPlaceholder,
  newExpr,
  onNewExprChange,
  exprPlaceholder,
  exprUsesTemplate,
  onAdd,
}: {
  title: string;
  description: string;
  mapping: Record<string, string>;
  onRemove: (key: string) => void;
  newKey: string;
  onNewKeyChange: (value: string) => void;
  keyPlaceholder: string;
  newExpr: string;
  onNewExprChange: (value: string) => void;
  exprPlaceholder: string;
  exprUsesTemplate: boolean;
  onAdd: () => void;
}) {
  return (
    <Card title={title} icon={InfoCardIcon}>
      <p className="text-xs text-text-secondary dark:text-text-secondary-dark mb-3">
        {description}
      </p>
      <div className="space-y-2 mb-3">
        {Object.entries(mapping).map(([key, expr]) => (
          <div
            key={key}
            className="flex items-center gap-2 p-2 bg-surface-overlay dark:bg-surface-dark-overlay rounded-sm"
          >
            <span className="font-mono text-sm text-text-secondary dark:text-text-secondary-dark shrink-0">
              {key}
            </span>
            <span className="text-text-muted dark:text-text-muted-dark">
              =
            </span>
            <span className="font-mono text-sm text-text-primary dark:text-text-primary-dark flex-1 truncate">
              {expr}
            </span>
            <IconButton
              onClick={() => onRemove(key)}
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
          value={newKey}
          onChange={(e) => onNewKeyChange(e.target.value)}
          size="sm"
          className="flex-1"
          placeholder={keyPlaceholder}
        />
        {exprUsesTemplate ? (
          <TemplateInput
            value={newExpr}
            onValueChange={onNewExprChange}
            size="sm"
            className="flex-1 font-mono"
            placeholder={exprPlaceholder}
          />
        ) : (
          <Input
            value={newExpr}
            onChange={(e) => onNewExprChange(e.target.value)}
            size="sm"
            className="flex-1 font-mono"
            placeholder={exprPlaceholder}
          />
        )}
        <Button variant="ghost" size="sm" onClick={onAdd}>
          Add
        </Button>
      </div>
    </Card>
  );
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
  const [forEach, setForEach] = useState<WorkflowCallForEach | undefined>(
    initialConfig.forEach,
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
    nextForEach: WorkflowCallForEach | undefined = forEach,
  ) {
    const nextConfig: NodeModalWorkflowCallConfig = {
      targetWorkflowId: nextTargetId,
      targetWorkflowName: nextTargetName,
      inputMapping: nextInputMapping,
      outputMapping: nextOutputMapping,
      ...(nextForEach ? { forEach: nextForEach } : {}),
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

  function setForEachEnabled(enabled: boolean) {
    const next = enabled ? { items: "", itemVariable: "" } : undefined;
    setForEach(next);
    writeConfig(undefined, undefined, undefined, undefined, next);
  }

  function patchForEach(patch: Partial<WorkflowCallForEach>) {
    const next = { ...(forEach ?? { items: "", itemVariable: "" }), ...patch };
    setForEach(next);
    writeConfig(undefined, undefined, undefined, undefined, next);
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
          <Select
            value={targetWorkflowId ?? ""}
            onChange={(e) => handleTargetChange(e.target.value)}
            disabled={loading}
            className="px-3 py-2 rounded-sm"
          >
            <option value="">
              {loading ? "Loading workflows…" : "Select a workflow"}
            </option>
            {workflows.map((w) => (
              <option key={w.workflowId} value={w.workflowId}>
                {w.name}
              </option>
            ))}
          </Select>
        </FormField>
      </Card>

      <Card title="For each" icon={InfoCardIcon}>
        <Toggle
          label="Run once per item"
          checked={forEach !== undefined}
          onChange={(event) => setForEachEnabled(event.target.checked)}
        />
        {forEach && (
          <div className="mt-3 space-y-3">
            <FormField
              label="Items"
              hint="A placeholder or JSON array literal that resolves to the items to iterate."
            >
              <TemplateInput
                value={forEach.items}
                onValueChange={(value) => patchForEach({ items: value })}
                size="sm"
                className="font-mono"
                placeholder="{{variables.userIds}}"
              />
            </FormField>
            <div className="grid gap-3 sm:grid-cols-2">
              <FormField
                label="Item variable"
                hint="The child variable receiving the current item."
              >
                <Input
                  value={forEach.itemVariable}
                  onChange={(event) =>
                    patchForEach({ itemVariable: event.target.value })
                  }
                  size="sm"
                  className="font-mono"
                  placeholder="userId"
                />
              </FormField>
              <FormField
                label="Index variable"
                hint="Optional; the item's zero-based index."
              >
                <Input
                  value={forEach.indexVariable ?? ""}
                  onChange={(event) => {
                    const { indexVariable: _drop, ...rest } = forEach;
                    void _drop;
                    const next: WorkflowCallForEach = event.target.value
                      ? { ...rest, indexVariable: event.target.value }
                      : rest;
                    setForEach(next);
                    writeConfig(undefined, undefined, undefined, undefined, next);
                  }}
                  size="sm"
                  className="font-mono"
                  placeholder="index"
                />
              </FormField>
            </div>
            <FormField
              label="Concurrency"
              hint="How many iterations run at once, from 1 to 16."
            >
              <Input
                type="number"
                min={1}
                max={WORKFLOW_CALL_FOR_EACH_MAX_CONCURRENCY}
                value={forEach.concurrency ?? 1}
                onChange={(event) =>
                  patchForEach({
                    concurrency: Math.min(
                      Math.max(Number(event.target.value) || 1, 1),
                      WORKFLOW_CALL_FOR_EACH_MAX_CONCURRENCY,
                    ),
                  })
                }
              />
            </FormField>
            <Toggle
              label="Stop on failure"
              checked={forEach.stopOnFailure ?? true}
              onChange={(event) =>
                patchForEach({ stopOnFailure: event.target.checked })
              }
            />
          </div>
        )}
      </Card>

      <MappingCard
        title="Input mapping"
        description="Resolved in this workflow's context, then written into the target workflow's variables before it runs."
        mapping={inputMapping}
        onRemove={removeInputMapping}
        newKey={newInputKey}
        onNewKeyChange={setNewInputKey}
        keyPlaceholder="target variable"
        newExpr={newInputExpr}
        onNewExprChange={setNewInputExpr}
        exprPlaceholder="{{variables.userId}}"
        exprUsesTemplate
        onAdd={addInputMapping}
      />

      <MappingCard
        title="Output mapping"
        description="Read from the target workflow's variables once it completes, then written into this workflow's variables."
        mapping={outputMapping}
        onRemove={removeOutputMapping}
        newKey={newOutputKey}
        onNewKeyChange={setNewOutputKey}
        keyPlaceholder="caller variable"
        newExpr={newOutputExpr}
        onNewExprChange={setNewOutputExpr}
        exprPlaceholder="target's variable name"
        exprUsesTemplate={false}
        onAdd={addOutputMapping}
      />
    </div>
  );
}
