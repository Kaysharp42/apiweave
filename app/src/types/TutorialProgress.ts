/**
 * Persisted, renderer-only tutorial progress. Independent of workflows and
 * never written into workflow state or sync payloads.
 */
export interface TutorialProgress {
  readonly completedLessonIds: readonly string[];
  readonly lastLessonId: string | null;
  /** Zero-based step index within `lastLessonId`; reserved for the companion. */
  readonly currentStep: number;
}
