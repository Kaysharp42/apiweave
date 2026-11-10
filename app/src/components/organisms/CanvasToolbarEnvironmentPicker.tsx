import { Globe } from "lucide-react";
import ButtonSelect from "../ButtonSelect";
import { buildEnvironmentOptions } from "./canvasToolbarUtils";
import type { CanvasToolbarEnvironmentPickerProps } from "../../types";

/** The environment picker with its name showing. */
const ENVIRONMENT_TRIGGER_CLASS =
  "flex w-full min-w-0 items-center gap-1.5 px-2.5 py-1.5 text-sm font-medium rounded-sm bg-surface-raised dark:bg-surface-dark-raised text-text-primary dark:text-text-primary-dark border border-border dark:border-border-dark hover:bg-surface-overlay dark:hover:bg-surface-dark-overlay transition-colors motion-reduce:transition-none h-8 whitespace-nowrap";

/** The same picker at the last density step: a globe, named by its tooltip. */
const ENVIRONMENT_ICON_TRIGGER_CLASS =
  "flex h-8 w-8 items-center justify-center rounded-sm bg-surface-raised dark:bg-surface-dark-raised text-text-primary dark:text-text-primary-dark border border-border dark:border-border-dark hover:bg-surface-overlay dark:hover:bg-surface-dark-overlay transition-colors motion-reduce:transition-none";

/**
 * The environment picker.
 *
 * The first control allowed to give ground. Everything else in the bar is
 * `shrink-0`; at the labelled and icon tiers the environment name truncates
 * instead of the Run button being pushed off the edge, and at the last tier
 * the name goes entirely and the picker becomes a globe.
 */
export function CanvasToolbarEnvironmentPicker({
  environments,
  selectedEnvironment,
  onEnvironmentChange,
  showLabel,
  workflowId,
}: CanvasToolbarEnvironmentPickerProps) {
  return (
    <ButtonSelect
      key={`env-select-${workflowId ?? ""}`}
      options={buildEnvironmentOptions(environments)}
      value={selectedEnvironment}
      onChange={onEnvironmentChange}
      placeholder="No environment"
      label="Environment"
      iconOnly={!showLabel}
      icon={<Globe className="w-4 h-4" />}
      containerClass={showLabel ? "min-w-24 max-w-56" : "shrink-0"}
      buttonClass={
        showLabel ? ENVIRONMENT_TRIGGER_CLASS : ENVIRONMENT_ICON_TRIGGER_CLASS
      }
    />
  );
}
