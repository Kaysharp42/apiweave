import { useState } from "react";
import {
  ArrowRight,
  Clock,
  Filter,
  Info,
  Sparkles,
  X,
  type LucideIcon,
} from "lucide-react";
import { Button } from "../atoms/Button";
import { IconButton } from "../atoms/IconButton";
import { Input } from "../atoms/Input";
import { Toggle } from "../atoms/Toggle";
import { Tooltip } from "../atoms/Tooltip";
import { Card } from "../molecules/Card";
import { FormField } from "../molecules/FormField";
import type {
  MergeConditionType,
  MergeConfigPanelProps,
  NodeModalConditionLogic,
  NodeModalMergeConfig,
  NodeModalMergeStrategy,
  NodeModalMergeTabKey,
} from "../../types";

const CONDITION_OPERATORS = [
  "equals",
  "notEquals",
  "contains",
  "gt",
  "lt",
  "exists",
];

function createCardIcon(Icon: LucideIcon) {
  return function CardIcon({ className }: { className?: string }) {
    return <Icon className={className} />;
  };
}

const FilterCardIcon = createCardIcon(Filter);
const InfoCardIcon = createCardIcon(Info);

const STRATEGY_TIPS: Record<NodeModalMergeStrategy, string> = {
  all: "Tip: Use Wait for All when downstream nodes need every branch result.",
  any: "Tip: Use Wait for Any for fastest-success fallback flows.",
  first:
    "Tip: First Completes is useful when branch order is less important than response speed.",
  conditional:
    "Tip: Conditional merge evaluates branch fields before allowing the workflow to continue.",
};

const STRATEGY_OPTIONS: Array<{
  key: NodeModalMergeStrategy;
  title: string;
  description: string;
  icon: LucideIcon;
}> = [
  {
    key: "all",
    title: "Wait for All",
    description: "All branches must complete before continuing",
    icon: Clock,
  },
  {
    key: "any",
    title: "Wait for Any",
    description: "Continue after first successful branch",
    icon: Sparkles,
  },
  {
    key: "first",
    title: "First Completes",
    description: "Use the first branch result",
    icon: ArrowRight,
  },
  {
    key: "conditional",
    title: "Conditional",
    description: "Continue only if conditions match",
    icon: Filter,
  },
];

function normalizeBranchIndex(value: string): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function createCondition(): MergeConditionType {
  return {
    branchIndex: 0,
    field: "response.statusCode",
    operator: "equals",
    value: "200",
  };
}

export function MergeConfigPanel({
  initialConfig,
  workingDataRef,
  activeTab = "strategy",
}: MergeConfigPanelProps) {
  const [mergeStrategy, setMergeStrategy] = useState<NodeModalMergeStrategy>(
    initialConfig.mergeStrategy ?? "all",
  );
  const [conditions, setConditions] = useState<MergeConditionType[]>(
    initialConfig.conditions ?? [],
  );
  const [conditionLogic, setConditionLogic] = useState<NodeModalConditionLogic>(
    initialConfig.conditionLogic ?? "OR",
  );
  const [continueOnFail, setContinueOnFail] = useState(
    initialConfig.continueOnFail ?? false,
  );

  const writeConfig = (
    nextStrategy = mergeStrategy,
    nextConditions = conditions,
    nextConditionLogic = conditionLogic,
    nextContinueOnFail = continueOnFail,
  ) => {
    const nextConfig: NodeModalMergeConfig = {
      mergeStrategy: nextStrategy,
      conditions: nextConditions,
      conditionLogic: nextConditionLogic,
      continueOnFail: nextContinueOnFail,
    };
    workingDataRef.current = {
      ...workingDataRef.current,
      config: { ...nextConfig },
    };
  };

  const updateStrategy = (nextStrategy: NodeModalMergeStrategy) => {
    setMergeStrategy(nextStrategy);
    writeConfig(nextStrategy);
  };

  const addCondition = () => {
    const nextConditions = [...conditions, createCondition()];
    setConditions(nextConditions);
    writeConfig(mergeStrategy, nextConditions);
  };

  const removeCondition = (index: number) => {
    const nextConditions = conditions.filter(
      (_, currentIndex) => currentIndex !== index,
    );
    setConditions(nextConditions);
    writeConfig(mergeStrategy, nextConditions);
  };

  const updateCondition = (
    index: number,
    patch: Partial<MergeConditionType>,
  ) => {
    const nextConditions = conditions.map((condition, currentIndex) =>
      currentIndex === index ? { ...condition, ...patch } : condition,
    );
    setConditions(nextConditions);
    writeConfig(mergeStrategy, nextConditions);
  };

  const renderStrategy = () => (
    <div className="space-y-4">
      <div className="grid gap-3 xl:grid-cols-2">
        {STRATEGY_OPTIONS.map((option) => {
          const selected = option.key === mergeStrategy;
          const StrategyCardIcon = createCardIcon(option.icon);
          return (
            <Card
              key={option.key}
              title={option.title}
              icon={StrategyCardIcon}
              className={
                selected
                  ? "border-primary bg-primary/5 ring-2 ring-primary/20 dark:border-primary-light dark:bg-primary-light/10 dark:ring-primary-light/20"
                  : ""
              }
              headerActions={
                <Button
                  variant={selected ? "primary" : "secondary"}
                  size="xs"
                  onClick={() => updateStrategy(option.key)}
                >
                  {selected ? "Selected" : "Select"}
                </Button>
              }
            >
              <p className="text-sm text-text-secondary dark:text-text-secondary-dark">
                {option.description}
              </p>
            </Card>
          );
        })}
      </div>

      <div className="rounded-sm border border-border bg-surface-overlay p-3 text-xs text-text-secondary dark:border-border-dark dark:bg-surface-dark-overlay dark:text-text-secondary-dark">
        <span className="font-semibold text-text-primary dark:text-text-primary-dark">
          {STRATEGY_TIPS[mergeStrategy].split(":")[0]}:
        </span>
        {STRATEGY_TIPS[mergeStrategy].slice(4)}
      </div>
    </div>
  );

  const renderConditionsDisabled = () => (
    <Tooltip
      content="Conditions only apply to Conditional strategy"
      placement="top"
    >
      <div className="rounded-sm border border-dashed border-border bg-surface-overlay p-6 text-center opacity-60 dark:border-border-dark dark:bg-surface-dark-overlay">
        <Filter
          className="mx-auto mb-3 h-8 w-8 text-text-muted dark:text-text-muted-dark"
          aria-hidden="true"
        />
        <p className="font-display text-lg font-semibold text-text-primary dark:text-text-primary-dark">
          Conditions are available for Conditional strategy
        </p>
        <p className="mt-2 text-sm text-text-secondary dark:text-text-secondary-dark">
          Switch the merge strategy to Conditional to add branch rules.
        </p>
      </div>
    </Tooltip>
  );

  const renderConditions = () => {
    if (mergeStrategy !== "conditional") return renderConditionsDisabled();

    return (
      <div className="space-y-4">
        <Card title="Condition logic" icon={FilterCardIcon}>
          <FormField
            label="Evaluate with"
            hint="AND requires every condition to pass; OR allows any passing condition."
          >
            <div className="flex flex-wrap gap-2">
              {(["AND", "OR"] as NodeModalConditionLogic[]).map((logic) => (
                <Button
                  key={logic}
                  variant={conditionLogic === logic ? "primary" : "secondary"}
                  size="sm"
                  onClick={() => {
                    setConditionLogic(logic);
                    writeConfig(mergeStrategy, conditions, logic);
                  }}
                >
                  {logic}
                </Button>
              ))}
            </div>
          </FormField>
        </Card>

        <div className="space-y-3">
          {conditions.map((condition, index) => (
            <Card
              key={`${condition.branchIndex}-${condition.field}-${condition.operator}-${condition.value}-${index}`}
              title={`Condition ${index + 1}`}
              icon={FilterCardIcon}
              headerActions={
                <IconButton
                  tooltip="Remove condition"
                  variant="ghost"
                  size="sm"
                  onClick={() => removeCondition(index)}
                >
                  <X className="h-4 w-4" />
                </IconButton>
              }
            >
              <div className="grid gap-4 xl:grid-cols-2">
                <FormField
                  label="Branch index"
                  hint="Zero-based branch position from incoming edges."
                >
                  <Input
                    type="number"
                    value={condition.branchIndex}
                    onChange={(event) =>
                      updateCondition(index, {
                        branchIndex: normalizeBranchIndex(event.target.value),
                      })
                    }
                    min="0"
                    className="font-mono"
                  />
                </FormField>
                <FormField
                  label="Field path"
                  hint="Use paths like response.statusCode or response.body.id."
                >
                  <Input
                    value={condition.field}
                    onChange={(event) =>
                      updateCondition(index, { field: event.target.value })
                    }
                    placeholder="response.body.total"
                    className="font-mono"
                  />
                </FormField>
              </div>

              <FormField
                label="Operator"
                hint="Exists only checks that the field is present and hides value input."
              >
                <div className="flex flex-wrap gap-2">
                  {CONDITION_OPERATORS.map((operator) => (
                    <Button
                      key={operator}
                      variant={
                        condition.operator === operator
                          ? "primary"
                          : "secondary"
                      }
                      size="xs"
                      onClick={() =>
                        updateCondition(index, {
                          operator,
                          value: operator === "exists" ? "" : condition.value,
                        })
                      }
                      className="font-mono"
                    >
                      {operator}
                    </Button>
                  ))}
                </div>
              </FormField>

              {condition.operator !== "exists" && (
                <FormField
                  label="Value"
                  hint="Supports literals and template variables."
                >
                  <Input
                    value={condition.value}
                    onChange={(event) =>
                      updateCondition(index, { value: event.target.value })
                    }
                    placeholder="42"
                    className="font-mono"
                  />
                </FormField>
              )}
            </Card>
          ))}
        </div>

        {conditions.length === 0 && (
          <div className="rounded-sm border border-dashed border-border bg-surface-overlay py-8 text-center text-sm text-text-muted dark:border-border-dark dark:bg-surface-dark-overlay dark:text-text-muted-dark">
            No conditions yet. Add one to gate conditional merge behavior.
          </div>
        )}

        <Button
          variant="primary"
          intent="success"
          size="sm"
          onClick={addCondition}
        >
          <Filter className="h-4 w-4" aria-hidden="true" />
          Add Condition
        </Button>
      </div>
    );
  };

  const renderSettings = () => (
    <Card title="Execution behavior" icon={InfoCardIcon}>
      <FormField
        label="Continue on failure"
        hint="When enabled, merge failures can be reported while downstream recovery nodes continue."
      >
        <Toggle
          label={
            continueOnFail ? "Continue if merge fails" : "Stop if merge fails"
          }
          checked={continueOnFail}
          onChange={(event) => {
            const nextValue = event.target.checked;
            setContinueOnFail(nextValue);
            writeConfig(mergeStrategy, conditions, conditionLogic, nextValue);
          }}
        />
      </FormField>
    </Card>
  );

  const tabRenderers: Record<NodeModalMergeTabKey, () => JSX.Element> = {
    strategy: renderStrategy,
    conditions: renderConditions,
    settings: renderSettings,
  };

  return <div className="space-y-4">{tabRenderers[activeTab]()}</div>;
}
