import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import {
  firstIncompleteLesson,
  isTutorialLessonId,
  nextTutorialLesson,
  TUTORIAL_LESSONS,
} from "../constants/tutorials/curriculum";
import { createGuardedLocalStorage } from "../utils/guardedStorage";
import type {
  TutorialPracticeStep,
  TutorialProgress,
  TutorialProgressSummary,
  TutorialResume,
  TutorialState,
} from "../types";

const STORAGE_KEY = "apiweave:v1:tutorialProgress";

/** Drop ids that no longer ship, and any duplicates, from stored progress. */
export function sanitizeCompletedLessonIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    if (!isTutorialLessonId(entry)) continue;
    if (seen.has(entry)) continue;
    seen.add(entry);
    result.push(entry);
  }
  return result;
}

function asLessonId(value: unknown): string | null {
  return typeof value === "string" && isTutorialLessonId(value) ? value : null;
}

function asStep(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : 0;
}

/**
 * Normalize a stored progress blob. Unknown lesson ids are filtered rather
 * than trusted, so a curriculum change cannot strand progress on a lesson that
 * no longer exists. `currentStep` from the pre-Phase-2 shape is deliberately
 * ignored — there is no compatibility path for it.
 */
export function sanitizeProgress(value: unknown): TutorialProgress {
  if (typeof value !== "object" || value === null) {
    return {
      completedLessonIds: [],
      lastLessonId: null,
      practiceLessonId: null,
      practiceStep: 0,
    };
  }
  const record = value as Record<string, unknown>;
  return {
    completedLessonIds: sanitizeCompletedLessonIds(
      record["completedLessonIds"],
    ),
    lastLessonId: asLessonId(record["lastLessonId"]),
    practiceLessonId: asLessonId(record["practiceLessonId"]),
    practiceStep: asStep(record["practiceStep"]),
  };
}

/** Clamp a step index to the practised lesson's bounds (0 when unpractised). */
function clampPracticeStep(lessonId: string | null, step: number): number {
  if (lessonId === null) return 0;
  const lesson = TUTORIAL_LESSONS.find((entry) => entry.id === lessonId);
  if (lesson === undefined) return 0;
  const max = Math.max(lesson.steps.length - 1, 0);
  return Math.min(Math.max(Math.floor(step), 0), max);
}

const useTutorialStore = create<TutorialState>()(
  persist(
    (set, get) => ({
      completedLessonIds: [],
      lastLessonId: null,
      practiceLessonId: null,
      practiceStep: 0,

      markComplete: (lessonId: string) => {
        if (!isTutorialLessonId(lessonId)) return;
        if (get().completedLessonIds.includes(lessonId)) return;
        set((state) => ({
          completedLessonIds: [...state.completedLessonIds, lessonId],
        }));
      },

      markIncomplete: (lessonId: string) => {
        if (!get().completedLessonIds.includes(lessonId)) return;
        set((state) => ({
          completedLessonIds: state.completedLessonIds.filter(
            (id) => id !== lessonId,
          ),
        }));
      },

      toggleComplete: (lessonId: string) => {
        const { completedLessonIds, markComplete, markIncomplete } = get();
        if (completedLessonIds.includes(lessonId)) {
          markIncomplete(lessonId);
        } else {
          markComplete(lessonId);
        }
      },

      setLastLesson: (lessonId: string) => {
        if (!isTutorialLessonId(lessonId)) return;
        if (get().lastLessonId === lessonId) return;
        set({ lastLessonId: lessonId });
      },

      startPractice: (lessonId: string) => {
        if (!isTutorialLessonId(lessonId)) return;
        if (get().practiceLessonId === lessonId) {
          // Resuming the same exercise keeps its step, clamped in case the
          // lesson gained or lost steps since it was stored.
          set((state) => ({
            practiceStep: clampPracticeStep(lessonId, state.practiceStep),
          }));
          return;
        }
        set({ practiceLessonId: lessonId, practiceStep: 0 });
      },

      setPracticeStep: (step: number) => {
        const { practiceLessonId } = get();
        if (practiceLessonId === null) return;
        set({ practiceStep: clampPracticeStep(practiceLessonId, step) });
      },

      endPractice: () => set({ practiceLessonId: null, practiceStep: 0 }),

      resetProgress: () =>
        set({
          completedLessonIds: [],
          lastLessonId: null,
          practiceLessonId: null,
          practiceStep: 0,
        }),
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => createGuardedLocalStorage()),
      partialize: (state) => ({
        completedLessonIds: state.completedLessonIds,
        lastLessonId: state.lastLessonId,
        practiceLessonId: state.practiceLessonId,
        practiceStep: state.practiceStep,
      }),
      // A malformed or older blob must not crash the reader; sanitize on the
      // way in and fall back to empty progress.
      merge: (persisted, current) => {
        const safe = sanitizeProgress(persisted);
        return {
          ...current,
          completedLessonIds: [...safe.completedLessonIds],
          lastLessonId: safe.lastLessonId,
          practiceLessonId: safe.practiceLessonId,
          practiceStep: clampPracticeStep(
            safe.practiceLessonId,
            safe.practiceStep,
          ),
        };
      },
    },
  ),
);

/** Completed/total counts for the library and page header. */
export function tutorialProgressSummary(
  completedLessonIds: readonly string[],
): TutorialProgressSummary {
  const completed = completedLessonIds.filter((id) =>
    isTutorialLessonId(id),
  ).length;
  return { completed, total: TUTORIAL_LESSONS.length };
}

/**
 * What the resume card should offer. When a lesson was explicitly started, the
 * card returns to it; otherwise it offers the first incomplete lesson. Once
 * every lesson is complete it still returns the last-visited (or first) lesson
 * so the reader can revisit, and `allComplete` tells the card to say so.
 */
export function tutorialResume(
  progress: TutorialProgress,
): TutorialResume | null {
  const completed = new Set(progress.completedLessonIds);
  const allComplete =
    TUTORIAL_LESSONS.length > 0 &&
    TUTORIAL_LESSONS.every((lesson) => completed.has(lesson.id));
  const lastLesson =
    progress.lastLessonId !== null
      ? (TUTORIAL_LESSONS.find(
          (lesson) => lesson.id === progress.lastLessonId,
        ) ?? null)
      : null;
  const lesson =
    lastLesson ??
    (allComplete
      ? (TUTORIAL_LESSONS[0] ?? null)
      : firstIncompleteLesson(completed));
  if (lesson === null) return null;
  return {
    lessonId: lesson.id,
    title: lesson.title,
    allComplete,
    started: lastLesson !== null,
  };
}

/**
 * Resolve the practised lesson and its clamped step for the companion, or
 * null when no exercise is active.
 */
export function tutorialPractice(
  progress: TutorialProgress,
): TutorialPracticeStep | null {
  if (progress.practiceLessonId === null) return null;
  const lesson = TUTORIAL_LESSONS.find(
    (entry) => entry.id === progress.practiceLessonId,
  );
  if (lesson === undefined || lesson.steps.length === 0) return null;
  const stepIndex = clampPracticeStep(lesson.id, progress.practiceStep);
  const step = lesson.steps[stepIndex];
  if (step === undefined) return null;
  return {
    lesson,
    stepIndex,
    stepNumber: stepIndex + 1,
    stepCount: lesson.steps.length,
    title: step.title,
    instruction: step.instruction,
    ...(step.detail !== undefined ? { detail: step.detail } : {}),
  };
}

/** The lesson that follows the given one, or null at the end of the course. */
export function tutorialNextLessonId(lessonId: string): string | null {
  return nextTutorialLesson(lessonId)?.id ?? null;
}

export default useTutorialStore;
