import { Tooltip } from "../../atoms/Tooltip";
import type { SidebarActionProps } from "../../../types";

/**
 * Reusable action button for sidebar items (export, delete, etc.).
 * The owning row hides the whole action overlay until hover/focus-within.
 */
export function SidebarAction({
  icon: Icon,
  label,
  onClick,
  destructive = false,
  className = "",
}: SidebarActionProps) {
  const baseClasses = [
    "inline-flex items-center justify-center rounded-sm p-2 transition-colors duration-150 motion-reduce:transition-none",
    "focus-visible:outline-2 focus-visible:outline-(--aw-primary) focus-visible:outline-offset-(--aw-focus-ring-offset)",
    "cursor-pointer",
  ].join(" ");

  const variantClasses = destructive
    ? "text-status-error hover:bg-status-error/10 hover:text-status-error dark:text-status-error-dark dark:hover:bg-status-error-dark/10 dark:hover:text-status-error-dark"
    : "text-text-muted dark:text-text-muted-dark hover:bg-surface-overlay dark:hover:bg-surface-dark-overlay hover:text-text-primary dark:hover:text-text-primary-dark";

  return (
    <Tooltip content={label}>
      <button
        type="button"
        onClick={onClick}
        className={[baseClasses, variantClasses, className]
          .filter(Boolean)
          .join(" ")}
        aria-label={label}
      >
        <Icon className="w-3.5 h-3.5" />
      </button>
    </Tooltip>
  );
}
