import { Badge } from "../atoms/Badge";
import { Kbd } from "../atoms/Kbd";
import { getNodeIcon } from "../node-modal/nodeModalUtils";
import type { BadgeProps, NodeStepMenuItemProps } from "../../types";

const HANDLE_BADGE: Readonly<Record<string, BadgeProps["variant"]>> = {
  pass: "success",
  fail: "error",
};

/** One branch in a step picker: its number key, the output it leaves from, and the node. */
export function NodeStepMenuItem({ step, index, active, onHover, onPick }: NodeStepMenuItemProps) {
  const Icon = getNodeIcon(step.nodeType);
  return (
    <button
      type="button"
      role="menuitem"
      onClick={() => onPick(step)}
      onMouseEnter={() => onHover(index)}
      className={[
        "flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left text-sm text-text-primary dark:text-text-primary-dark",
        active ? "bg-surface-overlay dark:bg-surface-dark-overlay" : "",
      ].join(" ")}
    >
      <Kbd className="w-3 shrink-0 text-center">{index + 1}</Kbd>
      {step.handle !== null && (
        <Badge variant={HANDLE_BADGE[step.handle] ?? "outline"} size="xs" className="capitalize">
          {step.handle}
        </Badge>
      )}
      <Icon className="h-3.5 w-3.5 shrink-0 text-text-muted dark:text-text-muted-dark" aria-hidden="true" />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate">{step.label}</span>
        {step.detail && (
          <span className="truncate font-mono text-2xs text-text-muted dark:text-text-muted-dark">
            {step.detail}
          </span>
        )}
      </span>
      {step.ranLastRun && (
        <span className="flex shrink-0 items-center gap-1 font-mono text-2xs text-text-muted dark:text-text-muted-dark">
          <span className="h-1.5 w-1.5 rounded-full bg-status-success dark:bg-(--aw-status-success)" aria-hidden="true" />
          last run
        </span>
      )}
    </button>
  );
}
