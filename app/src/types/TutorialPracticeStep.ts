import type { TutorialLesson } from "./TutorialLesson";

/** One row in the companion's step list — the instruction at a given index. */
export interface TutorialPracticeStep {
  readonly lesson: TutorialLesson;
  readonly stepIndex: number;
  readonly stepNumber: number;
  readonly stepCount: number;
  readonly title: string;
  readonly instruction: string;
  readonly detail?: string;
}
