import type { CheckboxOptionProps } from "../../types";

const INPUT_CLASS =
  "w-4 h-4 text-primary border-border dark:border-border-dark rounded-sm focus-visible:outline-2 focus-visible:outline-(--aw-primary) focus-visible:outline-offset-2 cursor-pointer";
const PLAIN_INPUT_CLASS = "w-4 h-4 rounded-sm";

/**
 * A checkbox with its label — the option rows shared by the import and export
 * dialogs. `plain` keeps the compact rows used inside tab panels.
 */
export function CheckboxOption({
  label,
  checked,
  onChange,
  variant = "default",
}: CheckboxOptionProps) {
  const plain = variant === "plain";

  return (
    <label className="flex items-center gap-3 cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className={plain ? PLAIN_INPUT_CLASS : INPUT_CLASS}
      />
      <span
        className={
          plain
            ? "text-text-primary dark:text-text-primary-dark"
            : "text-sm text-text-primary dark:text-text-primary-dark"
        }
      >
        {label}
      </span>
    </label>
  );
}
