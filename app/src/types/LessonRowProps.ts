import type { TutorialLesson } from "./TutorialLesson";

export interface LessonRowProps {
  readonly lesson: TutorialLesson;
  readonly isComplete: boolean;
  readonly isActive: boolean;
  readonly onSelect: (lessonId: string) => void;
  /** Chapter name shown under the title in search results. */
  readonly context?: string;
  /** Brief lesson summary shown under the title in search results. */
  readonly summary?: string;
}
