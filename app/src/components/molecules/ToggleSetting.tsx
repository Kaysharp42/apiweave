import type { ReactNode } from "react";
import { Toggle } from "../atoms/Toggle";

interface ToggleSettingProps {
  readonly title: string;
  /** What the setting does, and what it costs — the paragraph under the title. */
  readonly description: ReactNode;
  readonly checked: boolean;
  readonly onToggle: () => void;
  readonly disabled?: boolean;
}

/** A settings modal's headline row: what the switch is for, and the switch. */
export function ToggleSetting({
  title,
  description,
  checked,
  onToggle,
  disabled = false,
}: ToggleSettingProps) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <p className="text-sm font-medium text-text-primary dark:text-text-primary-dark">
          {title}
        </p>
        <p className="mt-1 text-xs text-text-secondary dark:text-text-secondary-dark">
          {description}
        </p>
      </div>
      <Toggle
        checked={checked}
        onChange={onToggle}
        disabled={disabled}
        variant="success"
      />
    </div>
  );
}
