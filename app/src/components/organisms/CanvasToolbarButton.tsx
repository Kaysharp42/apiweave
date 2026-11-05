import { Button } from "../atoms/Button";
import { Tooltip } from "../atoms/Tooltip";
import type { ToolbarButtonProps } from "../../types";

/** A labelled toolbar action that drops to its icon when the bar runs out of room. */
export function CanvasToolbarButton({
  icon: Icon,
  label,
  onClick,
  tooltip,
  showLabel = true,
}: ToolbarButtonProps) {
  return (
    <Tooltip content={tooltip || label}>
      <Button
        variant="ghost"
        size="sm"
        onClick={onClick}
        className="h-8 whitespace-nowrap text-text-secondary dark:text-text-secondary-dark hover:text-text-primary dark:hover:text-text-primary-dark"
        aria-label={label}
        icon={<Icon className="w-4 h-4 shrink-0" />}
      >
        {showLabel && <span>{label}</span>}
      </Button>
    </Tooltip>
  );
}
