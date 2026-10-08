import { useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { Button } from "../atoms/Button";
import { Toggle } from "../atoms/Toggle";
import { AssertionRulesEditor } from "../molecules/AssertionRulesEditor";
import { Card } from "../molecules/Card";
import { FormField } from "../molecules/FormField";
import type {
  AssertionConfigPanelProps,
  AssertionItem,
  NodeModalAssertionFailureMode,
  NodeModalAssertionTabKey,
} from "../../types";

function CheckCircleCardIcon({ className }: { className?: string }) {
  return <CheckCircle2 className={className} />;
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

  const updateRules = (nextAssertions: AssertionItem[]) => {
    setAssertions(nextAssertions);
    writeConfig(nextAssertions);
  };

  const renderRules = () => (
    <AssertionRulesEditor rules={assertions} onChange={updateRules} />
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
