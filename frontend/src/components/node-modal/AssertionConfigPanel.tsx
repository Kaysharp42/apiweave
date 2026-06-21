import { useState } from "react";
import {
  CheckCircle2,
  Info,
  Plus,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import ButtonSelect from "../ButtonSelect";
import { Button } from "../atoms/Button";
import { Input } from "../atoms/Input";
import { Toggle } from "../atoms/Toggle";
import { Card } from "../molecules/Card";
import { FormField } from "../molecules/FormField";
import type {
  AssertionConfigPanelProps,
  AssertionItem,
  NodeModalAssertionFailureMode,
  NodeModalAssertionTabKey,
  SelectOption,
} from "../../types";

const SOURCE_OPTIONS: SelectOption[] = [
  { label: "Previous result", value: "prev" },
  { label: "Workflow variables", value: "variables" },
  { label: "Status code", value: "status" },
  { label: "Cookies", value: "cookies" },
  { label: "Headers", value: "headers" },
];

const QUICK_ADD_OPTIONS: SelectOption[] = [
  { label: "Status is 200", value: "status-200" },
  { label: "Status is 2xx", value: "status-2xx" },
  { label: "Response time < 1000ms", value: "response-time-1000" },
  { label: "Body contains field", value: "body-contains-field" },
  { label: "Body field equals", value: "body-field-equals" },
];

const OPERATORS = [
  "equals",
  "notEquals",
  "contains",
  "notContains",
  "gt",
  "gte",
  "lt",
  "lte",
  "count",
  "exists",
  "notExists",
];
const VALUELESS_OPERATORS = ["exists", "notExists"];

function createCardIcon(Icon: LucideIcon) {
  return function CardIcon({ className }: { className?: string }) {
    return <Icon className={className} />;
  };
}

const CheckCircleCardIcon = createCardIcon(CheckCircle2);

function createEmptyAssertion(): AssertionItem {
  return {
    source: "prev",
    path: "response.body.",
    operator: "equals",
    expectedValue: "",
  };
}

function getAssertionSummary(assertion: AssertionItem): string {
  const target =
    assertion.source === "status"
      ? "status"
      : `${assertion.source}${assertion.path ? `.${assertion.path}` : ""}`;
  const expected = assertion.expectedValue ? ` ${assertion.expectedValue}` : "";
  return `${target} ${assertion.operator}${expected}`;
}

function getPathHint(source: string): string {
  if (source === "prev")
    return "Use response.body.id, response.headers.content-type, or response.statusCode.";
  if (source === "variables")
    return "Use a variable name without {{variables. }} wrappers.";
  if (source === "cookies") return "Use the cookie name to assert.";
  if (source === "headers") return "Use the response header name to assert.";
  return "Status code assertions do not need a path.";
}

export function AssertionConfigPanel({
  initialConfig,
  workingDataRef,
  activeTab = "rules",
}: AssertionConfigPanelProps) {
  const [assertions, setAssertions] = useState<AssertionItem[]>(
    initialConfig.assertions ?? [],
  );
  const [continueOnFail, setContinueOnFail] = useState(
    initialConfig.continueOnFail ?? false,
  );
  const [failureMode, setFailureMode] = useState<NodeModalAssertionFailureMode>(
    initialConfig.failureMode ?? "first",
  );

  const writeConfig = (
    nextAssertions: AssertionItem[],
    nextContinueOnFail = continueOnFail,
    nextFailureMode = failureMode,
  ) => {
    workingDataRef.current = {
      ...workingDataRef.current,
      config: {
        assertions: nextAssertions,
        continueOnFail: nextContinueOnFail,
        failureMode: nextFailureMode,
      },
    };
  };

  const updateAssertion = (index: number, patch: Partial<AssertionItem>) => {
    const updated = assertions.map((assertion, currentIndex) =>
      currentIndex === index ? { ...assertion, ...patch } : assertion,
    );
    setAssertions(updated);
    writeConfig(updated);
  };

  const appendAssertions = (newAssertions: AssertionItem[]) => {
    const updated = [...assertions, ...newAssertions];
    setAssertions(updated);
    writeConfig(updated);
  };

  const removeAssertion = (index: number) => {
    const updated = assertions.filter(
      (_, currentIndex) => currentIndex !== index,
    );
    setAssertions(updated);
    writeConfig(updated);
  };

  const handleQuickAdd = (template: string) => {
    if (template === "status-200") {
      appendAssertions([
        {
          source: "status",
          path: "",
          operator: "equals",
          expectedValue: "200",
        },
      ]);
      return;
    }
    if (template === "status-2xx") {
      appendAssertions([
        { source: "status", path: "", operator: "gte", expectedValue: "200" },
        { source: "status", path: "", operator: "lt", expectedValue: "300" },
      ]);
      return;
    }
    if (template === "response-time-1000") {
      appendAssertions([
        {
          source: "prev",
          path: "response.responseTimeMs",
          operator: "lt",
          expectedValue: "1000",
        },
      ]);
      return;
    }
    if (template === "body-contains-field") {
      appendAssertions([
        {
          source: "prev",
          path: "response.body.<fieldName>",
          operator: "exists",
          expectedValue: "",
        },
      ]);
      return;
    }
    appendAssertions([
      {
        source: "prev",
        path: "response.body.<fieldName>",
        operator: "equals",
        expectedValue: "",
      },
    ]);
  };

  const renderRules = () => (
    <div className="space-y-4">
      <div className="rounded-sm border border-status-info/30 bg-status-info/10 p-3 text-sm text-status-info dark:border-[var(--aw-status-info)]/30 dark:bg-[var(--aw-status-info)]/10 dark:text-[var(--aw-status-info)]">
        <p className="mb-1 flex items-center gap-2 font-medium">
          <Info className="h-4 w-4" aria-hidden="true" />
          Assertion rules
        </p>
        <p className="text-xs">
          Configured rules:{" "}
          <span className="font-bold">{assertions.length}</span>
        </p>
      </div>

      <div className="space-y-3">
        {assertions.map((assertion, index) => (
          <Card
            key={`${assertion.source}-${assertion.path}-${assertion.operator}-${assertion.expectedValue}-${index}`}
            title={getAssertionSummary(assertion)}
            icon={CheckCircleCardIcon}
            collapsible
            defaultExpanded={index === assertions.length - 1}
            headerActions={
              <Button
                variant="ghost"
                intent="error"
                size="xs"
                onClick={() => removeAssertion(index)}
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                Remove
              </Button>
            }
          >
            <div className="grid gap-4 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
              <FormField
                label="Source"
                hint="Choose the part of the previous execution context to inspect."
              >
                <ButtonSelect
                  options={SOURCE_OPTIONS}
                  value={assertion.source}
                  onChange={(value) =>
                    updateAssertion(index, {
                      source: value,
                      path: value === "status" ? "" : assertion.path,
                    })
                  }
                  buttonClass="flex h-10 w-full items-center justify-between rounded-sm border border-border bg-surface-raised px-3 text-sm text-text-primary transition-[border-color,outline,background-color] duration-[var(--aw-transition-fast)] ease-in-out focus-visible:outline-2 focus-visible:outline-[var(--aw-primary)] focus-visible:outline-offset-[var(--aw-focus-ring-offset)] dark:border-border-dark dark:bg-surface-dark-raised dark:text-text-primary-dark"
                />
              </FormField>

              <FormField label="Path" hint={getPathHint(assertion.source)}>
                <Input
                  value={assertion.path}
                  onChange={(event) =>
                    updateAssertion(index, { path: event.target.value })
                  }
                  placeholder={
                    assertion.source === "status"
                      ? "Not required"
                      : "response.body.id"
                  }
                  disabled={assertion.source === "status"}
                  className="font-mono"
                />
              </FormField>
            </div>

            <FormField
              label="Operator"
              hint="Use numeric operators for status codes and timings; exists/notExists ignore expected value."
            >
              <div className="flex flex-wrap gap-2">
                {OPERATORS.map((operator) => (
                  <Button
                    key={operator}
                    variant={
                      assertion.operator === operator ? "primary" : "secondary"
                    }
                    size="xs"
                    onClick={() =>
                      updateAssertion(index, {
                        operator,
                        expectedValue: VALUELESS_OPERATORS.includes(operator)
                          ? ""
                          : assertion.expectedValue,
                      })
                    }
                    className="font-mono"
                  >
                    {operator}
                  </Button>
                ))}
              </div>
            </FormField>

            {!VALUELESS_OPERATORS.includes(assertion.operator) && (
              <FormField
                label="Expected value"
                hint="Strings, numbers, booleans, and template variables are accepted."
              >
                <Input
                  value={assertion.expectedValue}
                  onChange={(event) =>
                    updateAssertion(index, {
                      expectedValue: event.target.value,
                    })
                  }
                  placeholder="200"
                  className="font-mono"
                />
              </FormField>
            )}
          </Card>
        ))}
      </div>

      {assertions.length === 0 && (
        <div className="rounded-sm border border-dashed border-border bg-surface-overlay py-8 text-center text-sm text-text-muted dark:border-border-dark dark:bg-surface-dark-overlay dark:text-text-muted-dark">
          No assertion rules yet. Add one or pick a quick template.
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-sm border border-border bg-surface-raised p-3 dark:border-border-dark dark:bg-surface-dark-raised">
        <Button
          variant="primary"
          intent="success"
          size="sm"
          onClick={() => appendAssertions([createEmptyAssertion()])}
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          Add Assertion
        </Button>
        <ButtonSelect
          options={QUICK_ADD_OPTIONS}
          value=""
          placeholder="Quick Add"
          onChange={handleQuickAdd}
          buttonClass="flex h-9 min-w-48 items-center justify-between rounded-sm border border-border bg-surface-raised px-3 text-sm text-text-primary transition-[border-color,outline,background-color] duration-[var(--aw-transition-fast)] ease-in-out focus-visible:outline-2 focus-visible:outline-[var(--aw-primary)] focus-visible:outline-offset-[var(--aw-focus-ring-offset)] dark:border-border-dark dark:bg-surface-dark-raised dark:text-text-primary-dark"
        />
      </div>
    </div>
  );

  const renderSettings = () => (
    <div className="space-y-4">
      <Card title="Failure behavior" icon={CheckCircleCardIcon}>
        <div className="space-y-4">
          <FormField
            label="Continue on failure"
            hint="When enabled, failed assertions are recorded but the workflow can proceed to downstream nodes."
          >
            <Toggle
              label={
                continueOnFail
                  ? "Continue after failed assertions"
                  : "Stop workflow on assertion failure"
              }
              checked={continueOnFail}
              onChange={(event) => {
                const nextValue = event.target.checked;
                setContinueOnFail(nextValue);
                writeConfig(assertions, nextValue, failureMode);
              }}
            />
          </FormField>

          <FormField
            label="Failure mode"
            hint="Stop on first failure is faster; run all gives a fuller report for test suites."
          >
            <div className="flex flex-wrap gap-2">
              {(
                [
                  ["first", "Stop on first failure"],
                  ["all", "Run all, report failures"],
                ] as Array<[NodeModalAssertionFailureMode, string]>
              ).map(([value, label]) => (
                <Button
                  key={value}
                  variant={failureMode === value ? "primary" : "secondary"}
                  size="sm"
                  onClick={() => {
                    setFailureMode(value);
                    writeConfig(assertions, continueOnFail, value);
                  }}
                >
                  {label}
                </Button>
              ))}
            </div>
          </FormField>
        </div>
      </Card>
    </div>
  );

  const tabRenderers: Record<NodeModalAssertionTabKey, () => JSX.Element> = {
    rules: renderRules,
    settings: renderSettings,
  };

  return <div className="space-y-4">{tabRenderers[activeTab]()}</div>;
}
