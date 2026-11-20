import type { MutableRefObject } from "react";
import type { NodeStep } from "./NodeStep";

export interface UseNodeStepPickerResult {
  readonly pickerOpen: boolean;
  readonly activeIndex: number;
  readonly setActiveIndex: (index: number) => void;
  /** Wraps the button and its picker: a press outside it closes the picker. */
  readonly rootRef: MutableRefObject<HTMLDivElement | null>;
  /** The button press: step, open the picker, or take its highlighted branch. */
  readonly activate: () => void;
  readonly closePicker: () => void;
  readonly go: (step: NodeStep | undefined) => void;
}
