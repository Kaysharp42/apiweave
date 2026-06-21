import type { IconSwitchProps } from "../../types";

const intentClassName: Record<
  NonNullable<IconSwitchProps["intent"]>,
  string
> = {
  primary:
    "bg-primary/10 dark:bg-primary-light/10 border-primary dark:border-primary-light text-primary dark:text-primary-light",
  success:
    "bg-status-success/10 dark:bg-[var(--aw-status-success)]/10 border-status-success dark:border-[var(--aw-status-success)] text-status-success dark:text-[var(--aw-status-success)]",
};

export function IconSwitch({
  checked,
  onCheckedChange,
  checkedIcon,
  uncheckedIcon,
  checkedLabel,
  uncheckedLabel,
  intent = "primary",
  disabled = false,
  className = "",
  ...rest
}: IconSwitchProps) {
  const label = checked ? checkedLabel : uncheckedLabel;

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={[
        "relative inline-flex h-7 w-14 flex-shrink-0 items-center rounded-sm border p-0.5",
        "transition-[box-shadow,background-color,border-color] duration-[var(--aw-transition-fast)] ease-in-out",
        "focus-visible:outline-2 focus-visible:outline-[var(--aw-primary)] focus-visible:outline-offset-[var(--aw-focus-ring-offset)]",
        checked
          ? intentClassName[intent]
          : "bg-surface-raised dark:bg-surface-dark-raised border-border dark:border-border-dark text-text-muted dark:text-text-muted-dark",
        disabled
          ? "cursor-not-allowed opacity-50 pointer-events-none"
          : "cursor-pointer hover:bg-surface-overlay dark:hover:bg-surface-dark-overlay",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      {...rest}
    >
      <span className="pointer-events-none absolute left-2 text-text-muted dark:text-text-muted-dark opacity-70">
        {uncheckedIcon}
      </span>
      <span className="pointer-events-none absolute right-2 text-primary dark:text-primary-light opacity-80">
        {checkedIcon}
      </span>
      <span
        className={[
          "pointer-events-none z-10 flex h-6 w-6 items-center justify-center rounded-sm border border-border bg-surface-raised text-text-primary transition-transform duration-[var(--aw-transition-fast)] ease-in-out dark:border-border-dark dark:bg-surface-dark-raised dark:text-text-primary-dark",
          checked ? "translate-x-7" : "translate-x-0",
        ].join(" ")}
      >
        <span
          className={
            checked
              ? "text-primary dark:text-primary-light"
              : "text-text-muted dark:text-text-muted-dark"
          }
        >
          {checked ? checkedIcon : uncheckedIcon}
        </span>
      </span>
    </button>
  );
}
