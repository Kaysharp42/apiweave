import type { RefObject } from "react";
import type { TutorialLesson } from "./TutorialLesson";

export interface TutorialLessonViewProps {
  readonly lesson: TutorialLesson;
  readonly chapterTitle: string;
  readonly isComplete: boolean;
  readonly headingRef: RefObject<HTMLHeadingElement>;
  /** Compact layouts show an "All lessons" action; wide layouts do not. */
  readonly showBackToLibrary: boolean;
  /**
   * Resolved in-app path for the lesson's verified destination. Rendered as a
   * router `Link`, never a raw anchor: the desktop build runs on `HashRouter`,
   * where a raw `href` would trigger a full-document navigation.
   */
  readonly destinationHref?: string;
  /** The library path, so the reader can always return to the workspace view. */
  readonly libraryHref: string;
  readonly onBackToLibrary: () => void;
  readonly onToggleComplete: (lessonId: string) => void;
  readonly onSelectLesson: (lessonId: string) => void;
  /** Titles for related ids, so the buttons do not show bare slugs. */
  readonly relatedLessonTitles: Readonly<Record<string, string>>;
  /** Start (or resume) the follow-along exercise for this lesson. */
  readonly onFollowAlong: (lessonId: string) => void;
  /** True when this lesson is the one currently in practice. */
  readonly isInPractice: boolean;
}
