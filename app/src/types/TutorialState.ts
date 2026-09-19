/**
 * The tutorial progress store's state and actions. Every action returns
 * nothing except the two completion predicates, which report whether the
 * state actually changed (used by tests and by callers that want to avoid a
 * redundant re-render).
 */
export interface TutorialState {
  completedLessonIds: string[];
  lastLessonId: string | null;
  practiceLessonId: string | null;
  practiceStep: number;

  /** Mark a lesson complete (idempotent). Returns true when it changed. */
  markComplete: (lessonId: string) => boolean;
  /** Reverse a completion. Returns true when it changed. */
  markIncomplete: (lessonId: string) => boolean;
  toggleComplete: (lessonId: string) => void;
  /** Record the lesson the reader is on, for the resume card. */
  setLastLesson: (lessonId: string) => void;
  /**
   * Begin (or resume) practising a lesson. Starting the lesson already in
   * practice keeps its step; starting a different one begins at step 0.
   * Unknown ids are ignored.
   */
  startPractice: (lessonId: string) => void;
  /** Move the practice step, clamped to the practised lesson's bounds. */
  setPracticeStep: (step: number) => void;
  /** End the practice session, clearing its lesson and step. */
  endPractice: () => void;
  /** Clear all progress, reading and practice alike. */
  resetProgress: () => void;
}
