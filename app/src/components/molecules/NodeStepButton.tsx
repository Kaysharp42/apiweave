import { ChevronLeft, ChevronRight, GitFork } from "lucide-react";
import { Button } from "../atoms/Button";
import { Tooltip } from "../atoms/Tooltip";
import { NodeStepMenu } from "./NodeStepMenu";
import { useNodeStepPicker } from "../../hooks/useNodeStepPicker";
import type { NodeStep, NodeStepButtonProps, NodeStepDirection } from "../../types";

/**
 * The button always reads Previous or Next: node names repeat ("Click",
 * "Click"), so a button titled with one reads as an action, not a direction.
 * Where it goes is in the tooltip, and in the picker at a fork.
 */
function describe(direction: NodeStepDirection, steps: readonly NodeStep[]) {
  const isNext = direction === "next";
  const name = isNext ? "Next" : "Previous";
  const keys = isNext ? "→, or Alt+→ while typing" : "←, or Alt+← while typing";
  if (steps.length > 1) {
    const choices = isNext ? `${steps.length} branches` : `${steps.length} inputs`;
    return {
      name,
      ariaLabel: `${name} node: choose one of ${choices}`,
      tooltip: `${name}: pick one of ${choices} (${keys})`,
    };
  }
  const only = steps[0];
  if (!only) return { name, ariaLabel: `${name} node`, tooltip: "" };
  const where = only.detail ? `${only.label} · ${only.detail}` : only.label;
  return {
    name,
    ariaLabel: `${name} node: ${only.label}`,
    tooltip: `${name}: ${where} (${keys})`,
  };
}

/**
 * One of the node editor's two step buttons. One neighbour is a straight
 * move; several (an assertion's Pass/Fail, a fan-out, a merge's inputs) open
 * a picker with the branch the last run took highlighted. The same arrow
 * again takes it, so following a run through the editor is → → → …
 */
export function NodeStepButton({ direction, steps, onStep, triggerRef }: NodeStepButtonProps) {
  const picker = useNodeStepPicker(direction, steps, onStep);
  const { name, ariaLabel, tooltip } = describe(direction, steps);
  const isNext = direction === "next";
  const Chevron = isNext ? ChevronRight : ChevronLeft;
  const fork = steps.length > 1;
  const menuId = `node-step-menu-${direction}`;

  return (
    <div ref={picker.rootRef} className="relative">
      <Tooltip content={tooltip} disabled={picker.pickerOpen}>
        <Button
          {...(triggerRef ? { ref: triggerRef } : {})}
          variant="ghost"
          size="xs"
          disabled={steps.length === 0}
          onClick={picker.pickerOpen ? picker.closePicker : picker.activate}
          aria-label={ariaLabel}
          {...(fork ? { "aria-haspopup": "menu" as const, "aria-expanded": picker.pickerOpen } : {})}
          {...(picker.pickerOpen ? { "aria-controls": menuId } : {})}
          {...(steps.length === 0
            ? { title: isNext ? "End of this branch" : "Start of the workflow" }
            : {})}
          className={`gap-1 px-1.5 ${isNext ? "flex-row-reverse" : ""}`}
        >
          <Chevron className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{name}</span>
          {fork && (
            <span className="flex items-center gap-0.5 font-mono text-2xs text-text-muted dark:text-text-muted-dark">
              <GitFork className="h-3 w-3" aria-hidden="true" />
              {steps.length}
            </span>
          )}
        </Button>
      </Tooltip>

      {picker.pickerOpen && (
        <NodeStepMenu
          id={menuId}
          direction={direction}
          steps={steps}
          activeIndex={picker.activeIndex}
          onHover={picker.setActiveIndex}
          onPick={picker.go}
        />
      )}
    </div>
  );
}
