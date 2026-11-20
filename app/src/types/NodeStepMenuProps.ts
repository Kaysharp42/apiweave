import type { NodeStep } from "./NodeStep";
import type { NodeStepDirection } from "./NodeStepDirection";

export interface NodeStepMenuProps {
  readonly id: string;
  readonly direction: NodeStepDirection;
  readonly steps: readonly NodeStep[];
  readonly activeIndex: number;
  readonly onHover: (index: number) => void;
  readonly onPick: (step: NodeStep) => void;
}
