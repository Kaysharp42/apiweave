import { useEffect, useState } from "react";
import { Lightbulb, X } from "lucide-react";
import { IconButton } from "../atoms/IconButton";
import type {
  PanelTipsButtonProps,
  PanelTipsSectionProps,
  PanelTipsSheetProps,
} from "../../types";

/**
 * PanelTipsButton — header affordance that opens a panel's tips sheet.
 *
 * Lives in the panel header so tips cost no vertical space, and carries an
 * unseen dot until the user opens them once (see `usePanelTips`).
 */
export function PanelTipsButton({
  isOpen,
  hasUnseen = false,
  onClick,
  label = "Tips & syntax",
  className = "",
}: PanelTipsButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={isOpen}
      aria-label={label}
      title={label}
      className={[
        "inline-flex flex-shrink-0 items-center gap-1 rounded-sm border px-1.5 py-1 text-[10px] font-medium cursor-pointer",
        "transition-colors duration-150 ease-in-out motion-reduce:transition-none",
        "focus-visible:outline-2 focus-visible:outline-[var(--aw-primary)] focus-visible:outline-offset-[var(--aw-focus-ring-offset)]",
        isOpen
          ? "border-primary bg-primary/10 text-primary dark:border-primary-light dark:bg-primary-light/15 dark:text-primary-light"
          : "border-border bg-surface text-text-secondary hover:border-primary/40 hover:text-primary dark:border-border-dark dark:bg-surface-dark dark:text-text-secondary-dark dark:hover:border-primary-light/40 dark:hover:text-primary-light",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <Lightbulb className="w-3 h-3 flex-shrink-0" aria-hidden="true" />
      <span>Tips</span>
      {hasUnseen && (
        <span
          className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-primary dark:bg-primary-light"
          aria-hidden="true"
        />
      )}
    </button>
  );
}

/**
 * PanelTipsSheet — overlay sheet that covers a panel's scroll area.
 *
 * Render it as the last child of a `relative` content wrapper. It brings its
 * own scroll container, so long cheat sheets stay fully reachable instead of
 * being clipped by the panel shell.
 */
export function PanelTipsSheet({
  isOpen,
  onClose,
  title = "Tips & syntax",
  children,
}: PanelTipsSheetProps) {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setIsVisible(false);
      return;
    }

    const frame = requestAnimationFrame(() => setIsVisible(true));
    return () => cancelAnimationFrame(frame);
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-label={title}
      className={[
        "absolute inset-0 z-20 flex flex-col bg-surface-raised dark:bg-surface-dark-raised",
        "border-t border-border shadow-lg dark:border-border-dark",
        "transition-[opacity,transform] duration-200 ease-out motion-reduce:transition-none",
        isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2",
      ].join(" ")}
    >
      <div className="flex flex-shrink-0 items-center justify-between gap-2 border-b border-border bg-surface-overlay px-3 py-2 dark:border-border-dark dark:bg-surface-dark-overlay">
        <div className="flex min-w-0 items-center gap-1.5">
          <Lightbulb
            className="w-3.5 h-3.5 flex-shrink-0 text-primary dark:text-primary-light"
            aria-hidden="true"
          />
          <h3 className="min-w-0 truncate text-xs font-semibold text-text-primary dark:text-text-primary-dark">
            {title}
          </h3>
        </div>
        <IconButton size="xs" tooltip="Close tips" onClick={onClose}>
          <X className="w-3.5 h-3.5" />
        </IconButton>
      </div>

      <div className="min-w-0 flex-1 overflow-y-auto overflow-x-hidden p-3 space-y-3 text-[11px] text-text-secondary dark:text-text-secondary-dark">
        {children}
      </div>
    </div>
  );
}

/** PanelTipsSection — titled group inside a tips sheet. */
export function PanelTipsSection({
  title,
  icon: Icon,
  children,
}: PanelTipsSectionProps) {
  return (
    <section className="min-w-0 space-y-1.5">
      <div className="flex items-center gap-1.5 text-text-primary dark:text-text-primary-dark">
        {Icon && (
          <Icon className="w-3.5 h-3.5 flex-shrink-0" aria-hidden="true" />
        )}
        <h4 className="min-w-0 truncate text-[11px] font-semibold uppercase tracking-wide">
          {title}
        </h4>
      </div>
      {children}
    </section>
  );
}

/** PanelTipsCode — inline code chip sized for the tips sheet. */
export function PanelTipsCode({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded border border-border bg-surface px-1 py-0.5 font-mono text-[10px] break-all text-text-primary dark:border-border-dark dark:bg-surface-dark dark:text-text-primary-dark">
      {children}
    </code>
  );
}
