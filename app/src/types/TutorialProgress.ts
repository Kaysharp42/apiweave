/**
 * Persisted, renderer-only tutorial progress. Independent of workflows and
 * never written into workflow state or sync payloads.
 *
 * Reading position (`lastLessonId`) and practice position
 * (`practiceLessonId`/`practiceStep`) are deliberately separate: consulting a
 * related article must never move the active exercise, and stepping through an
 * exercise must never change which lesson the reader last opened.
 */
export interface TutorialProgress {
  readonly completedLessonIds: readonly string[];
  readonly lastLessonId: string | null;
  /** The lesson the follow-along companion is practising, if any. */
  readonly practiceLessonId: string | null;
  /** Zero-based step index within `practiceLessonId`, clamped to its steps. */
  readonly practiceStep: number;
}
