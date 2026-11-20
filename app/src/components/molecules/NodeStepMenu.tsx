import { NodeStepMenuItem } from "./NodeStepMenuItem";
import type { NodeStepMenuProps } from "../../types";

/**
 * The branches a step button can take, numbered so a key picks one. Rendered
 * in place, not in a portal: inside the node editor a click on a portalled
 * element counts as outside its dialog and would close it.
 */
export function NodeStepMenu({ id, direction, steps, activeIndex, onHover, onPick }: NodeStepMenuProps) {
  const isNext = direction === "next";
  return (
    <div
      id={id}
      role="menu"
      aria-label={isNext ? "Next node" : "Previous node"}
      className={[
        "absolute top-full z-50 mt-1 w-96 overflow-hidden rounded-sm border border-border bg-surface-raised py-1 shadow-overlay dark:border-border-dark dark:bg-surface-dark-raised",
        isNext ? "right-0" : "left-0",
      ].join(" ")}
    >
      <p className="px-3 pb-1 pt-1.5 font-mono text-2xs font-semibold uppercase tracking-wide text-text-muted dark:text-text-muted-dark">
        {isNext ? "Next step" : "Previous step"}
      </p>
      {steps.map((step, index) => (
        <NodeStepMenuItem
          key={step.nodeId}
          step={step}
          index={index}
          active={index === activeIndex}
          onHover={onHover}
          onPick={onPick}
        />
      ))}
    </div>
  );
}
