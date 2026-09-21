import type { TutorialChapterId } from "./TutorialChapterId";
import type { TutorialLesson } from "./TutorialLesson";
import type { TutorialSearchField } from "./TutorialSearchField";

/** A lesson that matched a search query, with its chapter and matched fields. */
export interface TutorialSearchResult {
  readonly lesson: TutorialLesson;
  readonly chapterId: TutorialChapterId;
  readonly chapterTitle: string;
  readonly matchedFields: readonly TutorialSearchField[];
}
