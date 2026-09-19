/**
 * The tutorial progress store's state and actions. Every action returns
 * nothing except the two completion predicates, which report whether the
 * state actually changed (used by tests and by callers that want to avoid a
 * redundant re-render).
 */
export interface TutorialState {
  completedLessonIds: string[];
  lastLessonId: string | null;
  currentStep: number;

  /** Mark a lesson complete (idempotent). Returns true when it changed. */
  markComplete: (lessonId: string) => boolean;
  /** Reverse a completion. Returns true when it changed. */
  markIncomplete: (lessonId: string) => boolean;
  toggleComplete: (lessonId: string) => void;
  /** Record the lesson the reader is on, for the resume card. */
  setLastLesson: (lessonId: string) => void;
  /** Record the current step for the resume card (reserved for the companion). */
  setCurrentStep: (step: number) => void;
  /** Clear all progress. */
  resetProgress: () => void;
}
