import { Tooltip } from "./Tooltip";
import type { IconButtonProps } from "../../types";
import {
  cancelActivation,
  withoutActivationHandlers,
  withoutHoverClasses,
} from "./softDisabled";

const SIZE_CLASS: Record<string, string> = {
  xs: "h-6 w-6 text-xs",
  sm: "h-8 w-8 text-sm",
  md: "h-9 w-9 text-sm",
  lg: "h-10 w-10 text-base",
};

const VARIANT_CLASS: Record<string, string> = {
  ghost:
    "border border-transparent text-text-secondary dark:text-text-secondary-dark hover:bg-surface-overlay dark:hover:bg-surface-dark-overlay hover:text-text-primary dark:hover:text-text-primary-dark",
  primary:
    "border border-(--aw-primary) bg-(--aw-primary) text-on-primary hover:bg-(--aw-primary-hover)",
  secondary:
    "border border-border dark:border-border-dark bg-surface-raised dark:bg-surface-dark-raised text-text-primary dark:text-text-primary-dark hover:bg-surface-overlay dark:hover:bg-surface-dark-overlay",
  outline:
    "border border-border dark:border-border-dark bg-surface-raised dark:bg-surface-dark-raised text-text-secondary dark:text-text-secondary-dark hover:bg-text-primary dark:hover:bg-text-primary-dark hover:text-surface-raised dark:hover:text-surface-dark hover:border-text-primary dark:hover:border-text-primary-dark",
  success:
    "border border-status-success/40 dark:border-(--aw-status-success)/40 text-status-success dark:text-(--aw-status-success) hover:bg-status-success/10 dark:hover:bg-(--aw-status-success)/10",
  error:
    "border border-status-error/40 dark:border-(--aw-status-error)/40 text-status-error dark:text-(--aw-status-error) hover:bg-status-error/10 dark:hover:bg-(--aw-status-error)/10",
  warning:
    "border border-status-warning/40 dark:border-(--aw-status-warning)/40 text-status-warning dark:text-(--aw-status-warning) hover:bg-status-warning/10 dark:hover:bg-(--aw-status-warning)/10",
  info: "border border-status-info/40 dark:border-(--aw-status-info)/40 text-status-info dark:text-(--aw-status-info) hover:bg-status-info/10 dark:hover:bg-(--aw-status-info)/10",
};

/** A disabled button is dimmed and says so; one that can still explain itself keeps the pointer. */
function disabledClasses(disabled: boolean, softDisabled: boolean): string {
  if (!disabled) return "cursor-pointer";
  return softDisabled ? "cursor-not-allowed opacity-50" : "cursor-not-allowed opacity-50 pointer-events-none";
}

export function IconButton({
  children,
  tooltip,
  size = "sm",
  variant = "ghost",
  className = "",
  disabled = false,
  onClick,
  ...rest
}: IconButtonProps) {
  // A disabled button with a tooltip stays hoverable and focusable so the
  // tooltip can say why; see softDisabled.ts.
  const softDisabled = disabled && Boolean(tooltip || rest.title);
  const variantClasses = VARIANT_CLASS[variant] ?? VARIANT_CLASS.ghost ?? "";

  const buttonClassName = [
    "inline-flex items-center justify-center rounded-sm transition-[background-color,color,border-color,filter] duration-(--aw-transition-fast) ease-in-out",
    "focus-visible:outline-2 focus-visible:outline-(--aw-primary) focus-visible:outline-offset-(--aw-focus-ring-offset)",
    SIZE_CLASS[size] ?? SIZE_CLASS.sm,
    softDisabled ? withoutHoverClasses(variantClasses) : variantClasses,
    disabledClasses(disabled, softDisabled),
    className,
  ]
    .filter(Boolean)
    .join(" ");

  const button = (
    <button
      type="button"
      className={buttonClassName}
      disabled={disabled && !softDisabled}
      aria-disabled={softDisabled || undefined}
      onClick={softDisabled ? cancelActivation : onClick}
      aria-label={tooltip}
      {...(softDisabled ? withoutActivationHandlers(rest) : rest)}
    >
      {children}
    </button>
  );

  if (!tooltip) return button;

  return (
    <Tooltip content={tooltip}>
      {button}
    </Tooltip>
  );
}
