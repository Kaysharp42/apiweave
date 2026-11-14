import { AssertionOperatorSchema } from "@shared/zod-schemas/AssertionOperatorSchema";
import type { StreamFinishCondition } from "@shared/types/StreamFinishCondition";
import { Button } from "../atoms/Button";
import { Input } from "../atoms/Input";
import { FormField } from "../molecules/FormField";
import ButtonSelect from "../ButtonSelect";
import type { SelectOption, StreamFinishConditionsEditorProps } from "../../types";

const OPERATOR_OPTIONS: SelectOption[] = AssertionOperatorSchema.options.map(
  (operator) => ({ label: operator, value: operator }),
);

/** A new, empty finish rule: the shape every stream panel adds when the author clicks "Add finish rule". */
export function emptyFinishCondition(): StreamFinishCondition {
  return { path: "data.status", operator: "equals", expectedValue: "" };
}

/**
 * The finish rules shared by every stream node (SSE, WebSocket, gRPC server
 * streaming): all rules must match one received message to close the listener
 * and activate its Complete output.
 */
export function StreamFinishConditionsEditor({ conditions, onChange, hint, pathPlaceholder = "data.status" }: StreamFinishConditionsEditorProps) {
  const update = (index: number, patch: Partial<StreamFinishCondition>) => {
    onChange(conditions.map((condition, currentIndex) => (currentIndex === index ? { ...condition, ...patch } : condition)));
  };
  return (
    <div className="space-y-4">
      <div className="rounded-xs border border-status-info/30 bg-status-info/10 p-3 text-sm text-status-info dark:border-(--aw-status-info)/30 dark:bg-(--aw-status-info)/10 dark:text-(--aw-status-info)">
        {hint}
      </div>
      {conditions.map((condition, index) => (
        <div key={index} className="space-y-3 rounded-xs border border-border bg-surface-overlay p-3 dark:border-border-dark dark:bg-surface-dark-overlay">
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField label="Event path">
              <Input value={condition.path} onChange={(event) => update(index, { path: event.target.value })} placeholder={pathPlaceholder} className="font-mono" />
            </FormField>
            <FormField label="Operator">
              <ButtonSelect
                options={OPERATOR_OPTIONS}
                value={condition.operator}
                onChange={(operator) => update(index, { operator: operator as StreamFinishCondition["operator"] })}
                buttonClass="flex h-10 w-full items-center justify-between rounded-xs border border-border bg-surface-raised px-3 font-mono text-sm text-text-primary dark:border-border-dark dark:bg-surface-dark-raised dark:text-text-primary-dark"
              />
            </FormField>
          </div>
          {condition.operator !== "exists" && condition.operator !== "notExists" && (
            <FormField label="Expected value">
              <Input
                value={typeof condition.expectedValue === "string" ? condition.expectedValue : String(condition.expectedValue ?? "")}
                onChange={(event) => update(index, { expectedValue: event.target.value })}
                placeholder="completed"
                className="font-mono"
              />
            </FormField>
          )}
          <Button variant="ghost" intent="error" size="xs" onClick={() => onChange(conditions.filter((_, currentIndex) => currentIndex !== index))}>
            Remove rule
          </Button>
        </div>
      ))}
      <Button variant="secondary" size="sm" onClick={() => onChange([...conditions, emptyFinishCondition()])}>
        Add finish rule
      </Button>
    </div>
  );
}
