import type { Ref } from "react";
import type { NodeStep } from "./NodeStep";
import type { NodeStepDirection } from "./NodeStepDirection";

export interface NodeStepButtonProps {
  readonly direction: NodeStepDirection;
  /** Where this button can go: none disables it, one goes straight there, several open a picker. */
  readonly steps: readonly NodeStep[];
  readonly onStep: (step: NodeStep) => void;
  /** The trigger button, so the editor can give it focus after a step. */
  readonly triggerRef?: Ref<HTMLButtonElement>;
}
