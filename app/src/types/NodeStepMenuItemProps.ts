import type { NodeStep } from "./NodeStep";

export interface NodeStepMenuItemProps {
  readonly step: NodeStep;
  readonly index: number;
  readonly active: boolean;
  readonly onHover: (index: number) => void;
  readonly onPick: (step: NodeStep) => void;
}
