import { X } from "lucide-react";
import { IconButton } from "./IconButton";
import type { CanvasTipProps } from "../../types/CanvasTipProps";

/** A single, non-blocking canvas hint. */
export function CanvasTip({ tip, shortcut, onDismiss }: CanvasTipProps) {
  return (
    <div className="pointer-events-none absolute bottom-4 left-1/2 z-20 -translate-x-1/2">
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-auto flex items-center gap-2 rounded-sm border border-border bg-surface-raised px-2 py-1.5 text-xs text-text-secondary shadow-node dark:border-border-dark dark:bg-surface-dark-raised dark:text-text-secondary-dark"
      >
        <span>{tip.text}</span>
        {shortcut && (
          <kbd className="rounded-sm border border-border bg-surface px-1 py-0.5 font-mono text-[10px] text-text-primary dark:border-border-dark dark:bg-surface-dark dark:text-text-primary-dark">
            {shortcut}
          </kbd>
        )}
        <IconButton
          size="xs"
          variant="ghost"
          tooltip="Dismiss tip"
          aria-label="Dismiss canvas tip"
          onClick={onDismiss}
        >
          <X className="h-3.5 w-3.5" />
        </IconButton>
      </div>
    </div>
  );
}
