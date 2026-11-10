import React from "react";
import { Loader2 } from "lucide-react";
import type { ButtonProps } from "../../types";
import {
  cancelActivation,
  withoutActivationHandlers,
  withoutHoverClasses,
} from "./softDisabled";

type ButtonIntent = NonNullable<ButtonProps["intent"]>;

/** The `primary` variant's surface per intent: the action's own colour, filled. */
const PRIMARY_INTENT: Record<ButtonIntent, string> = {
  default:
    "bg-(--aw-primary) text-on-primary border border-(--aw-primary) hover:bg-(--aw-primary-hover) shadow-raised hover:shadow-overlay",
  muted:
    "bg-text-muted dark:bg-text-muted-dark text-surface-raised dark:text-surface-dark border border-text-muted dark:border-text-muted-dark hover:bg-text-secondary dark:hover:bg-text-secondary-dark",
  success:
    "bg-status-success dark:bg-(--aw-status-success) text-white dark:text-surface-dark border border-status-success dark:border-(--aw-status-success) hover:brightness-95 dark:hover:brightness-105 shadow-raised hover:shadow-overlay",
  error:
    "bg-status-error dark:bg-(--aw-status-error) text-white dark:text-surface-dark border border-status-error dark:border-(--aw-status-error) hover:brightness-95 dark:hover:brightness-105 shadow-raised hover:shadow-overlay",
  warning:
    "bg-status-warning dark:bg-(--aw-status-warning) text-white dark:text-surface-dark border border-status-warning dark:border-(--aw-status-warning) hover:brightness-95 dark:hover:brightness-105 shadow-raised hover:shadow-overlay",
  info: "bg-status-info dark:bg-(--aw-status-info) text-white dark:text-surface-dark border border-status-info dark:border-(--aw-status-info) hover:brightness-95 dark:hover:brightness-105 shadow-raised hover:shadow-overlay",
};

/** The `secondary` variant: a tinted surface and a hairline, the action's colour in the text. */
const SECONDARY_INTENT: Record<ButtonIntent, string> = {
  default:
    "bg-primary/5 dark:bg-primary-light/10 text-primary dark:text-primary-light border border-primary dark:border-primary-light hover:bg-primary/10 dark:hover:bg-primary-light/20",
  muted:
    "bg-text-muted/5 dark:bg-text-muted-dark/10 text-text-muted dark:text-text-muted-dark border border-text-muted/30 dark:border-text-muted-dark/30 hover:bg-text-muted/10 dark:hover:bg-text-muted-dark/20",
  success:
    "bg-status-success/5 dark:bg-(--aw-status-success)/10 text-status-success dark:text-(--aw-status-success) border border-status-success dark:border-(--aw-status-success) hover:bg-status-success/10 dark:hover:bg-(--aw-status-success)/20",
  error:
    "bg-status-error/5 dark:bg-(--aw-status-error)/10 text-status-error dark:text-(--aw-status-error) border border-status-error dark:border-(--aw-status-error) hover:bg-status-error/10 dark:hover:bg-(--aw-status-error)/20",
  warning:
    "bg-status-warning/5 dark:bg-(--aw-status-warning)/10 text-status-warning dark:text-(--aw-status-warning) border border-status-warning dark:border-(--aw-status-warning) hover:bg-status-warning/10 dark:hover:bg-(--aw-status-warning)/20",
  info: "bg-status-info/5 dark:bg-(--aw-status-info)/10 text-status-info dark:text-(--aw-status-info) border border-status-info dark:border-(--aw-status-info) hover:bg-status-info/10 dark:hover:bg-(--aw-status-info)/20",
};

/** The `ghost` variant: no surface until hover, the action's colour in the text. */
const GHOST_INTENT: Record<ButtonIntent, string> = {
  default:
    "text-text-secondary dark:text-text-secondary-dark hover:bg-surface-overlay dark:hover:bg-surface-dark-overlay",
  muted:
    "text-text-muted dark:text-text-muted-dark hover:bg-surface-overlay dark:hover:bg-surface-dark-overlay",
  success:
    "text-status-success dark:text-(--aw-status-success) hover:bg-status-success/5 dark:hover:bg-(--aw-status-success)/10",
  error:
    "text-status-error dark:text-(--aw-status-error) hover:bg-status-error/5 dark:hover:bg-(--aw-status-error)/10",
  warning:
    "text-status-warning dark:text-(--aw-status-warning) hover:bg-status-warning/5 dark:hover:bg-(--aw-status-warning)/10",
  info: "text-status-info dark:text-(--aw-status-info) hover:bg-status-info/5 dark:hover:bg-(--aw-status-info)/10",
};

/** The `outline` variant: a panel's surface and hairline, with the action's colour in the text. */
const OUTLINE_INTENT: Record<ButtonIntent, string> = {
  default:
    "bg-surface-raised dark:bg-surface-dark-raised text-text-primary dark:text-text-primary-dark border border-border dark:border-border-dark hover:bg-text-primary dark:hover:bg-text-primary-dark hover:text-surface-raised dark:hover:text-surface-dark hover:border-text-primary dark:hover:border-text-primary-dark",
  muted:
    "bg-surface-raised dark:bg-surface-dark-raised text-text-muted dark:text-text-muted-dark border border-border dark:border-border-dark hover:bg-surface-overlay dark:hover:bg-surface-dark-overlay hover:text-text-primary dark:hover:text-text-primary-dark",
  success:
    "bg-surface-raised dark:bg-surface-dark-raised text-status-success dark:text-(--aw-status-success) border border-status-success/40 dark:border-(--aw-status-success)/40 hover:bg-status-success/10 dark:hover:bg-(--aw-status-success)/10",
  error:
    "bg-surface-raised dark:bg-surface-dark-raised text-status-error dark:text-(--aw-status-error) border border-status-error/40 dark:border-(--aw-status-error)/40 hover:bg-status-error/10 dark:hover:bg-(--aw-status-error)/10",
  warning:
    "bg-surface-raised dark:bg-surface-dark-raised text-status-warning dark:text-(--aw-status-warning) border border-status-warning/40 dark:border-(--aw-status-warning)/40 hover:bg-status-warning/10 dark:hover:bg-(--aw-status-warning)/10",
  info: "bg-surface-raised dark:bg-surface-dark-raised text-status-info dark:text-(--aw-status-info) border border-status-info/40 dark:border-(--aw-status-info)/40 hover:bg-status-info/10 dark:hover:bg-(--aw-status-info)/10",
};

/** Chrome that states something rather than inviting a click: a panel's surface, a secondary label, and a hover that acknowledges the pointer without turning into an action. */
const NEUTRAL_CLASS =
  "bg-surface-raised dark:bg-surface-dark-raised text-text-secondary dark:text-text-secondary-dark border border-border dark:border-border-dark hover:bg-surface-overlay dark:hover:bg-surface-dark-overlay hover:text-text-primary dark:hover:text-text-primary-dark";

function variantClasses(variant: NonNullable<ButtonProps["variant"]>, intent: ButtonIntent): string {
  switch (variant) {
    case "primary":
      return PRIMARY_INTENT[intent];
    case "secondary":
      return SECONDARY_INTENT[intent];
    case "ghost":
      return GHOST_INTENT[intent];
    case "outline":
      return OUTLINE_INTENT[intent];
    case "neutral":
      return NEUTRAL_CLASS;
    default:
      return "";
  }
}

/** A disabled button is dimmed and says so; one that can still explain itself keeps the pointer. */
function disabledClasses(isDisabled: boolean, softDisabled: boolean): string {
  if (!isDisabled) return "cursor-pointer";
  return softDisabled ? "opacity-50 cursor-not-allowed" : "opacity-50 cursor-not-allowed pointer-events-none";
}

const SIZE_CLASSES: Record<NonNullable<ButtonProps["size"]>, string> = {
  xs: "px-2 py-1 text-xs",
  sm: "px-3 py-1.5 text-sm",
  md: "px-4 py-2 text-sm",
  lg: "px-6 py-3 text-base",
};

/** The button's whole class list, in one place so the component body stays a rendering. */
function buttonClassName(
  variant: NonNullable<ButtonProps["variant"]>,
  intent: ButtonIntent,
  size: NonNullable<ButtonProps["size"]>,
  isDisabled: boolean,
  softDisabled: boolean,
  fullWidth: boolean,
  extra: string,
): string {
  const surface = variantClasses(variant, intent);
  return [
    "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-sm",
    "transition-[box-shadow,background-color,color,filter] duration-(--aw-transition-fast) ease-in-out",
    "focus-visible:outline-2 focus-visible:outline-(--aw-primary) focus-visible:outline-offset-(--aw-focus-ring-offset)",
    SIZE_CLASSES[size],
    softDisabled ? withoutHoverClasses(surface) : surface,
    disabledClasses(isDisabled, softDisabled),
    fullWidth ? "w-full" : "",
    extra,
  ]
    .filter(Boolean)
    .join(" ");
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      children,
      variant = "primary",
      intent = "default",
      size = "md",
      loading = false,
      disabled = false,
      fullWidth = false,
      icon,
      className = "",
      type = "button",
      onClick,
      ...rest
    },
    ref,
  ) => {
    const isDisabled = disabled || loading;
    // A disabled button with a title stays hoverable and focusable so the
    // title can say why; see softDisabled.ts.
    const softDisabled = isDisabled && Boolean(rest.title);

    return (
      <button
        ref={ref}
        type={type}
        className={buttonClassName(variant, intent, size, isDisabled, softDisabled, fullWidth, className)}
        disabled={isDisabled && !softDisabled}
        aria-disabled={softDisabled || undefined}
        aria-busy={loading}
        onClick={softDisabled ? cancelActivation : onClick}
        {...(softDisabled ? withoutActivationHandlers(rest) : rest)}
      >
        {loading && (
          <Loader2
            className="w-4 h-4 animate-spin motion-reduce:animate-none"
            aria-hidden="true"
          />
        )}
        {icon && !loading && icon}
        {children}
      </button>
    );
  },
);

Button.displayName = "Button";
