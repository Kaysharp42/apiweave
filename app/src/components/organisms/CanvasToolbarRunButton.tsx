import { Loader2, Play, Square } from "lucide-react";
import { Button } from "../atoms/Button";
import type { CanvasToolbarRunButtonProps } from "../../types";

/** Run while idle; Cancel while running, or a spinner when there is nothing to cancel. */
export function CanvasToolbarRunButton({
  onRun,
  onCancel,
  isRunning,
}: CanvasToolbarRunButtonProps) {
  return (
    <Button
      variant="primary"
      intent={isRunning ? "warning" : "default"}
      size="sm"
      onClick={isRunning && onCancel ? onCancel : onRun}
      disabled={isRunning && !onCancel}
      className="rounded-l-xs rounded-r-none h-8 whitespace-nowrap font-semibold border-r border-surface-raised/30 dark:border-surface-dark-raised/30"
      icon={
        isRunning ? (
          onCancel ? (
            <Square className="w-4 h-4" />
          ) : (
            <Loader2 className="w-4 h-4 animate-spin motion-reduce:animate-none" />
          )
        ) : (
          <Play className="w-4 h-4" />
        )
      }
    >
      {isRunning ? (onCancel ? "Cancel" : "Running…") : "Run"}
    </Button>
  );
}
