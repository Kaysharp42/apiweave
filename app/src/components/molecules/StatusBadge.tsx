import {
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  AlertTriangle,
  Info,
  type LucideIcon,
} from "lucide-react";
import type { StatusBadgeProps } from "../../types";

export function StatusBadge({
  status = "idle",
  label,
  size = "sm",
  className = "",
}: StatusBadgeProps) {
  const statusMap: Record<
    string,
    { icon: LucideIcon; text: string; badgeClass: string; iconClass: string }
  > = {
    idle: {
      icon: Clock,
      text: "Idle",
      badgeClass:
        "border-border bg-surface-raised text-text-secondary dark:border-border-dark dark:bg-surface-dark-raised dark:text-text-secondary-dark",
      iconClass: "text-text-muted dark:text-text-muted-dark",
    },
    running: {
      icon: Loader2,
      text: "Running",
      badgeClass:
        "border-status-running/30 bg-status-running/10 text-status-running dark:border-[var(--aw-status-running)]/30 dark:bg-[var(--aw-status-running)]/10 dark:text-[var(--aw-status-running)]",
      iconClass:
        "text-status-running dark:text-[var(--aw-status-running)] animate-spin motion-reduce:animate-none",
    },
    success: {
      icon: CheckCircle2,
      text: "Success",
      badgeClass:
        "border-status-success/30 bg-status-success/10 text-status-success dark:border-[var(--aw-status-success)]/30 dark:bg-[var(--aw-status-success)]/10 dark:text-[var(--aw-status-success)]",
      iconClass: "text-status-success dark:text-[var(--aw-status-success)]",
    },
    error: {
      icon: XCircle,
      text: "Failed",
      badgeClass:
        "border-status-error/30 bg-status-error/10 text-status-error dark:border-[var(--aw-status-error)]/30 dark:bg-[var(--aw-status-error)]/10 dark:text-[var(--aw-status-error)]",
      iconClass: "text-status-error dark:text-[var(--aw-status-error)]",
    },
    warning: {
      icon: AlertTriangle,
      text: "Warning",
      badgeClass:
        "border-status-warning/30 bg-status-warning/10 text-status-warning dark:border-[var(--aw-status-warning)]/30 dark:bg-[var(--aw-status-warning)]/10 dark:text-[var(--aw-status-warning)]",
      iconClass: "text-status-warning dark:text-[var(--aw-status-warning)]",
    },
    info: {
      icon: Info,
      text: "Info",
      badgeClass:
        "border-status-info/30 bg-status-info/10 text-status-info dark:border-[var(--aw-status-info)]/30 dark:bg-[var(--aw-status-info)]/10 dark:text-[var(--aw-status-info)]",
      iconClass: "text-status-info dark:text-[var(--aw-status-info)]",
    },
  };

  const config = statusMap[status] ?? statusMap.idle;
  const Icon = config!.icon;
  const text = config!.text;
  const badgeClass = config!.badgeClass;
  const iconClass = config!.iconClass;

  const sizeClass =
    size === "sm"
      ? "px-2 py-0.5 text-xs"
      : size === "xs"
        ? "px-1.5 py-0.5 text-[10px]"
        : "px-2.5 py-1 text-sm";
  const iconSize =
    size === "xs" ? "w-3 h-3" : size === "sm" ? "w-3 h-3" : "w-4 h-4";
  const displayText = label ?? text;

  return (
    <span
      className={[
        "inline-flex max-w-full items-center gap-1 rounded-full border font-mono font-medium leading-none",
        badgeClass,
        sizeClass,
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      aria-label={displayText}
      role="status"
    >
      <Icon className={`${iconSize} ${iconClass}`} aria-hidden="true" />
      <span className="truncate">{displayText}</span>
    </span>
  );
}
