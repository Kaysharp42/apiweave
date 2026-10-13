import { CheckCircle2, Info, Plus, Trash2 } from "lucide-react";
import ButtonSelect from "../ButtonSelect";
import { Button } from "../atoms/Button";
import { Input } from "../atoms/Input";
import { Card } from "./Card";
import { FormField } from "./FormField";
import type {
  AssertionItem,
  AssertionRulesEditorProps,
  SelectOption,
} from "../../types";

const QUICK_ADD_OPTIONS: SelectOption[] = [
  { label: "Status is 200", value: "status-200" },
  { label: "Status is 2xx", value: "status-2xx" },
  { label: "Response time < 1000ms", value: "response-time-1000" },
  { label: "Body contains field", value: "body-contains-field" },
  { label: "Body field equals", value: "body-field-equals" },
];

const QUICK_ADD_RULES: Record<string, AssertionItem[]> = {
  "status-200": [
    { source: "status", path: "", operator: "equals", expectedValue: "200" },
  ],
  "status-2xx": [
    { source: "status", path: "", operator: "gte", expectedValue: "200" },
    { source: "status", path: "", operator: "lt", expectedValue: "300" },
  ],
  "response-time-1000": [
    {
      source: "prev",
      path: "response.duration",
      operator: "lt",
      expectedValue: "1000",
    },
  ],
  "body-contains-field": [
    {
      source: "prev",
      path: "response.body.<fieldName>",
      operator: "exists",
      expectedValue: "",
    },
  ],
  "body-field-equals": [
    {
      source: "prev",
      path: "response.body.<fieldName>",
      operator: "equals",
      expectedValue: "",
    },
  ],
};

const OPERATORS: AssertionItem["operator"][] = [
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
const VALUELESS_OPERATORS: AssertionItem["operator"][] = ["exists", "notExists"];

const SELECT_BUTTON_CLASS =
  "flex h-10 w-full items-center justify-between rounded-sm border border-border bg-surface-raised px-3 text-sm text-text-primary transition-[border-color,outline,background-color] duration-[var(--aw-transition-fast)] ease-in-out focus-visible:outline-2 focus-visible:outline-[var(--aw-primary)] focus-visible:outline-offset-[var(--aw-focus-ring-offset)] dark:border-border-dark dark:bg-surface-dark-raised dark:text-text-primary-dark";

function CheckCircleCardIcon({ className }: { className?: string }) {
  return <CheckCircle2 className={className} />;
}

function createEmptyRule(): AssertionItem {
  return {
    source: "prev",
    path: "response.body.",
    operator: "equals",
    expectedValue: "",
  };
}

function getRuleSummary(rule: AssertionItem): string {
  const target =
    rule.source === "status"
      ? "status"
      : `${rule.source}${rule.path ? `.${rule.path}` : ""}`;
  const expected = rule.expectedValue ? ` ${rule.expectedValue}` : "";
  return `${target} ${rule.operator}${expected}`;
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

/** The assertion rule list: one card per rule, plus Add and Quick Add. Shared by the Assertion node and an HTTP request's Retry until. */
export function AssertionRulesEditor({
  rules,
  onChange,
  responseLabel = "Previous result",
}: AssertionRulesEditorProps) {
  const sourceOptions: SelectOption[] = [
    { label: responseLabel, value: "prev" },
    { label: "Workflow variables", value: "variables" },
    { label: "Status code", value: "status" },
    { label: "Cookies", value: "cookies" },
    { label: "Headers", value: "headers" },
  ];

  const updateRule = (index: number, patch: Partial<AssertionItem>) =>
    onChange(
      rules.map((rule, currentIndex) =>
        currentIndex === index ? { ...rule, ...patch } : rule,
      ),
    );

  return (
    <div className="space-y-4">
      <div className="rounded-sm border border-status-info/30 bg-status-info/10 p-3 text-sm text-status-info dark:border-[var(--aw-status-info)]/30 dark:bg-[var(--aw-status-info)]/10 dark:text-[var(--aw-status-info)]">
        <p className="mb-1 flex items-center gap-2 font-medium">
          <Info className="h-4 w-4" aria-hidden="true" />
          Assertion rules
        </p>
        <p className="text-xs">
          Configured rules: <span className="font-bold">{rules.length}</span>
        </p>
      </div>

      <div className="space-y-3">
        {rules.map((rule, index) => (
          <Card
            key={`${rule.source}-${rule.path}-${rule.operator}-${rule.expectedValue}-${index}`}
            title={getRuleSummary(rule)}
            icon={CheckCircleCardIcon}
            collapsible
            defaultExpanded={index === rules.length - 1}
            headerActions={
              <Button
                variant="ghost"
                intent="error"
                size="xs"
                onClick={() =>
                  onChange(
                    rules.filter((_, currentIndex) => currentIndex !== index),
                  )
                }
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                Remove
              </Button>
            }
          >
            <div className="grid gap-4 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
              <FormField
                label="Source"
                hint="Choose the part of the response or workflow state to inspect."
              >
                <ButtonSelect
                  options={sourceOptions}
                  value={rule.source}
                  onChange={(value) =>
                    updateRule(index, {
                      source: value as AssertionItem["source"],
                      path: value === "status" ? "" : rule.path,
                    })
                  }
                  buttonClass={SELECT_BUTTON_CLASS}
                />
              </FormField>

              <FormField label="Path" hint={getPathHint(rule.source)}>
                <Input
                  value={rule.path}
                  onChange={(event) =>
                    updateRule(index, { path: event.target.value })
                  }
                  placeholder={
                    rule.source === "status" ? "Not required" : "response.body.id"
                  }
                  disabled={rule.source === "status"}
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
                    variant={rule.operator === operator ? "primary" : "secondary"}
                    size="xs"
                    onClick={() =>
                      updateRule(index, {
                        operator,
                        expectedValue: VALUELESS_OPERATORS.includes(operator)
                          ? ""
                          : rule.expectedValue,
                      })
                    }
                    className="font-mono"
                  >
                    {operator}
                  </Button>
                ))}
              </div>
            </FormField>

            {!VALUELESS_OPERATORS.includes(rule.operator) && (
              <FormField
                label="Expected value"
                hint="Strings, numbers, booleans, and template variables are accepted."
              >
                <Input
                  value={rule.expectedValue}
                  onChange={(event) =>
                    updateRule(index, { expectedValue: event.target.value })
                  }
                  placeholder="200"
                  className="font-mono"
                />
              </FormField>
            )}
          </Card>
        ))}
      </div>

      {rules.length === 0 && (
        <div className="rounded-sm border border-dashed border-border bg-surface-overlay py-8 text-center text-sm text-text-muted dark:border-border-dark dark:bg-surface-dark-overlay dark:text-text-muted-dark">
          No assertion rules yet. Add one or pick a quick template.
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-sm border border-border bg-surface-raised p-3 dark:border-border-dark dark:bg-surface-dark-raised">
        <Button
          variant="primary"
          intent="success"
          size="sm"
          onClick={() => onChange([...rules, createEmptyRule()])}
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          Add Assertion
        </Button>
        <ButtonSelect
          options={QUICK_ADD_OPTIONS}
          value=""
          placeholder="Quick Add"
          onChange={(template) =>
            onChange([...rules, ...(QUICK_ADD_RULES[template] ?? [])])
          }
          buttonClass="flex h-9 min-w-48 items-center justify-between rounded-sm border border-border bg-surface-raised px-3 text-sm text-text-primary transition-[border-color,outline,background-color] duration-[var(--aw-transition-fast)] ease-in-out focus-visible:outline-2 focus-visible:outline-[var(--aw-primary)] focus-visible:outline-offset-[var(--aw-focus-ring-offset)] dark:border-border-dark dark:bg-surface-dark-raised dark:text-text-primary-dark"
        />
      </div>
    </div>
  );
}
