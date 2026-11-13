import { Gauge, Play, RefreshCw } from "lucide-react";
import { MenuSeparator } from "@headlessui/react";
import { CanvasToolbarMenuItem } from "./CanvasToolbarMenuItem";
import type { CanvasToolbarRunMenuItemsProps } from "../../types";

/** The rows of the Run options menu: rerun failed branches, or resume from one step. */
export function CanvasToolbarRunMenuItems({
  isRunning,
  resumeOptions,
  isResumeLoading,
  onRerunFailed,
  onLoad,
  onRunFromFailedNode,
}: CanvasToolbarRunMenuItemsProps) {
  const hasResumeOptions = resumeOptions.length > 0;

  return (
    <>
      {onLoad !== undefined && (
        <>
          <CanvasToolbarMenuItem
            icon={Gauge}
            label="Load run…"
            title="Many runs in parallel: latency percentiles and throughput"
            disabled={isRunning}
            onSelect={onLoad}
          />
          <MenuSeparator className="h-px bg-border dark:bg-border-dark" />
        </>
      )}
      <CanvasToolbarMenuItem
        icon={RefreshCw}
        label="Rerun failed branches"
        disabled={isRunning || !hasResumeOptions || isResumeLoading}
        hint={
          isResumeLoading
            ? "Loading failed nodes…"
            : !hasResumeOptions
              ? "No failed run to rerun."
              : undefined
        }
        onSelect={() => onRerunFailed?.()}
      />

      {!isResumeLoading && hasResumeOptions && (
        <>
          <MenuSeparator className="h-px bg-border dark:bg-border-dark" />
          {resumeOptions.map((opt) => (
            <CanvasToolbarMenuItem
              key={opt.nodeId}
              icon={Play}
              label={`Run from ${opt.label}`}
              title={opt.nodeId}
              disabled={isRunning}
              onSelect={() => onRunFromFailedNode?.(opt.nodeId)}
            />
          ))}
        </>
      )}
    </>
  );
}
