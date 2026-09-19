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

/**
 * Normalize a stored progress blob. Unknown lesson ids are filtered rather
 * than trusted, so a curriculum change cannot strand progress on a lesson that
 * no longer exists.
 */
export function sanitizeProgress(value: unknown): TutorialProgress {
  if (typeof value !== "object" || value === null) {
    return { completedLessonIds: [], lastLessonId: null, currentStep: 0 };
  }
  const record = value as Record<string, unknown>;
  const completedLessonIds = sanitizeCompletedLessonIds(
    record["completedLessonIds"],
  );
  const rawLast = record["lastLessonId"];
  const lastLessonId =
    typeof rawLast === "string" && isTutorialLessonId(rawLast) ? rawLast : null;
  const rawStep = record["currentStep"];
  const currentStep =
    typeof rawStep === "number" && Number.isFinite(rawStep) && rawStep >= 0
      ? Math.floor(rawStep)
      : 0;
  return { completedLessonIds, lastLessonId, currentStep };
}

const useTutorialStore = create<TutorialState>()(
  persist(
    (set, get) => ({
      completedLessonIds: [],
      lastLessonId: null,
      currentStep: 0,

      markComplete: (lessonId: string) => {
        if (!isTutorialLessonId(lessonId)) return false;
        if (get().completedLessonIds.includes(lessonId)) return false;
        set((state) => ({
          completedLessonIds: [...state.completedLessonIds, lessonId],
        }));
        return true;
      },

      markIncomplete: (lessonId: string) => {
        if (!get().completedLessonIds.includes(lessonId)) return false;
        set((state) => ({
          completedLessonIds: state.completedLessonIds.filter(
            (id) => id !== lessonId,
          ),
        }));
        return true;
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
        set({ lastLessonId: lessonId, currentStep: 0 });
      },

      setCurrentStep: (step: number) => {
        if (!Number.isFinite(step) || step < 0) return;
        set({ currentStep: Math.floor(step) });
      },

      resetProgress: () =>
        set({ completedLessonIds: [], lastLessonId: null, currentStep: 0 }),
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => createGuardedLocalStorage()),
      partialize: (state) => ({
        completedLessonIds: state.completedLessonIds,
        lastLessonId: state.lastLessonId,
        currentStep: state.currentStep,
      }),
      // A malformed or older blob must not crash the reader; sanitize on the
      // way in and fall back to empty progress.
      merge: (persisted, current) => {
        const safe = sanitizeProgress(persisted);
        return {
          ...current,
          completedLessonIds: [...safe.completedLessonIds],
          lastLessonId: safe.lastLessonId,
          currentStep: safe.currentStep,
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
    lastLesson ?? (allComplete ? (TUTORIAL_LESSONS[0] ?? null) : firstIncompleteLesson(completed));
  if (lesson === null) return null;
  const stepCount = lesson.steps.length;
  const stepNumber = Math.min(
    Math.max(progress.currentStep + 1, 1),
    Math.max(stepCount, 1),
  );
  return {
    lessonId: lesson.id,
    title: lesson.title,
    stepNumber,
    stepCount,
    allComplete,
    started: lastLesson !== null,
  };
}

/** The lesson that follows the given one, or null at the end of the course. */
export function tutorialNextLessonId(lessonId: string): string | null {
  return nextTutorialLesson(lessonId)?.id ?? null;
}

export default useTutorialStore;
