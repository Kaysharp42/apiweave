import type { TutorialChapterId } from "./TutorialChapterId";
import type { TutorialDestination } from "./TutorialDestination";
import type { TutorialExample } from "./TutorialExample";
import type { TutorialLessonId } from "./TutorialLessonId";
import type { TutorialStep } from "./TutorialStep";

/**
 * One bundled tutorial lesson. Every field is authored content that ships in
 * the renderer bundle — nothing here is read from `docs/`, which is not
 * packaged with the desktop app.
 */
export interface TutorialLesson {
  readonly id: TutorialLessonId;
  readonly chapterId: TutorialChapterId;
  readonly title: string;
  readonly summary: string;
  /** What the reader can do after finishing the lesson. */
  readonly outcome: string;
  readonly keywords: readonly string[];
  readonly durationMinutes: number;
  readonly prerequisites: readonly string[];
  readonly steps: readonly TutorialStep[];
  readonly example: TutorialExample;
  readonly expectedResult: string;
  readonly troubleshooting: readonly TutorialStep[];
  readonly relatedLessonIds: readonly TutorialLessonId[];
  /** A verified in-app surface this lesson points at. */
  readonly destination?: TutorialDestination;
  /** True when the exercise sends a request to a public host. */
  readonly requiresNetwork?: boolean;
}
