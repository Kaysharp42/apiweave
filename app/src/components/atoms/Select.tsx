import type { SelectProps } from "../../types";

/** A native `<select>` in the form controls' look: the browser keeps its keyboard and screen-reader behaviour. */
export function Select({ className = "", children, ...rest }: SelectProps) {
  return (
    <select
      className={`w-full rounded-sm border border-border bg-surface-raised px-2 py-1.5 text-sm text-text-primary focus-visible:outline-2 focus-visible:outline-[var(--aw-primary)] focus-visible:outline-offset-[var(--aw-focus-ring-offset)] disabled:opacity-60 dark:border-border-dark dark:bg-surface-dark-raised dark:text-text-primary-dark ${className}`}
      {...rest}
    >
      {children}
    </select>
  );
}
