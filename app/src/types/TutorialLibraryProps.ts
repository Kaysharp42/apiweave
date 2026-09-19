import type { RefObject } from "react";
import type { TutorialChapter } from "./TutorialChapter";
import type { TutorialProgressSummary } from "./TutorialProgressSummary";
import type { TutorialResume } from "./TutorialResume";

export interface TutorialLibraryProps {
  readonly chapters: readonly TutorialChapter[];
  readonly activeLessonId: string | null;
  readonly completedLessonIds: ReadonlySet<string>;
  /** The lesson the reader last opened, for the in-progress marker. */
  readonly lastLessonId: string | null;
  readonly progress: TutorialProgressSummary;
  readonly resume: TutorialResume | null;
  /** Search text is owned by the page so it survives a compact round trip. */
  readonly query: string;
  readonly onQueryChange: (query: string) => void;
  /** Focus target for the library heading when it becomes the whole view. */
  readonly headingRef?: RefObject<HTMLHeadingElement>;
  /** Returns to the workspace canvas, for the library view. */
  readonly onBackToWorkspace: () => void;
  /**
   * Whether to show the workspace exit in the library header. Hidden when the
   * library is the wide sidebar beside an article, which has its own exit, so
   * the two do not both offer the same action.
   */
  readonly showBackToWorkspace?: boolean;
  readonly onSelectLesson: (lessonId: string) => void;
}
