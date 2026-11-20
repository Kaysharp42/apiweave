import { useEffect, useRef, useState } from "react";
import { matchShortcut } from "../constants/keyboardShortcuts";
import { isEditableKeyboardTarget } from "../utils/shortcutGuards";
import { nodeStepPickerIntent } from "../utils/nodeStepPickerIntent";
import { usePopoverDismiss } from "./usePopoverDismiss";
import type { NodeStep } from "../types/NodeStep";
import type { NodeStepDirection } from "../types/NodeStepDirection";
import type { NodeStepPickerIntent } from "../types/NodeStepPickerIntent";
import type { UseNodeStepPickerResult } from "../types/UseNodeStepPickerResult";

/**
 * One step button's behaviour: its arrow key, and the branch picker it opens
 * when there is more than one place to go. The picker starts on the branch
 * the last run took.
 */
export function useNodeStepPicker(
  direction: NodeStepDirection,
  steps: readonly NodeStep[],
  onStep: (step: NodeStep) => void,
): UseNodeStepPickerResult {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const action = direction === "next" ? "nextNode" : "previousNode";

  const go = (step: NodeStep | undefined) => {
    if (!step) return;
    setPickerOpen(false);
    onStep(step);
  };

  const activate = () => {
    if (steps.length <= 1) return go(steps[0]);
    if (pickerOpen) return go(steps[activeIndex]);
    setActiveIndex(Math.max(0, steps.findIndex((step) => step.ranLastRun)));
    setPickerOpen(true);
  };

  const apply = (intent: NodeStepPickerIntent) => {
    if (intent.kind === "close") setPickerOpen(false);
    if (intent.kind === "take") go(steps[activeIndex]);
    if (intent.kind === "pick") go(steps[intent.index]);
    if (intent.kind === "move") {
      setActiveIndex((index) => (index + intent.by + steps.length) % steps.length);
    }
  };

  // A bare arrow belongs to the field that has focus; Alt+arrow works anywhere.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || matchShortcut(event) !== action) return;
      if (!event.altKey && isEditableKeyboardTarget(event.target)) return;
      event.preventDefault();
      activate();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  });

  // While the picker is open it owns the keyboard, so Escape closes the
  // picker and not the whole editor.
  usePopoverDismiss({
    active: pickerOpen,
    rootRef,
    onOutsidePress: () => setPickerOpen(false),
    onKeyDown: (event) => {
      const intent = nodeStepPickerIntent(event, direction, steps.length);
      if (intent !== null) apply(intent);
      return intent !== null;
    },
  });

  return {
    pickerOpen,
    activeIndex,
    setActiveIndex,
    rootRef,
    activate,
    closePicker: () => setPickerOpen(false),
    go,
  };
}
