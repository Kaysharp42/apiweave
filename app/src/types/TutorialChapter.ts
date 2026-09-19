import type { TutorialChapterId } from "./TutorialChapterId";
import type { TutorialLesson } from "./TutorialLesson";

/** A titled group of lessons, in reading order. */
export interface TutorialChapter {
  readonly id: TutorialChapterId;
  readonly title: string;
  readonly summary: string;
  readonly lessons: readonly TutorialLesson[];
}
