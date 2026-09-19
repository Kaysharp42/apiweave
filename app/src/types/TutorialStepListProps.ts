import type { TutorialStep } from "./TutorialStep";

export interface TutorialStepListProps {
  readonly steps: readonly TutorialStep[];
  /** Numbered `<ol>` when true (instructions); plain `<ul>` when false (Q&A). */
  readonly ordered?: boolean;
}
