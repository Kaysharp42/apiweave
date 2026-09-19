import { beforeEach, describe, expect, it } from "vitest";
import useTutorialStore, {
  sanitizeCompletedLessonIds,
  sanitizeProgress,
  tutorialNextLessonId,
  tutorialProgressSummary,
  tutorialResume,
} from "./TutorialStore";
import { TUTORIAL_LESSONS } from "../constants/tutorials/curriculum";

const TOTAL = TUTORIAL_LESSONS.length;

beforeEach(() => {
  useTutorialStore.getState().resetProgress();
  localStorage.clear();
});

describe("TutorialStore completion", () => {
  it("marks a lesson complete once and reverses it", () => {
    const store = useTutorialStore.getState();
    expect(store.markComplete("first-workflow")).toBe(true);
    expect(store.markComplete("first-workflow")).toBe(false);
    expect(useTutorialStore.getState().completedLessonIds).toEqual([
      "first-workflow",
    ]);

    expect(useTutorialStore.getState().markIncomplete("first-workflow")).toBe(
      true,
    );
    expect(useTutorialStore.getState().completedLessonIds).toEqual([]);
  });

  it("toggles completion", () => {
    useTutorialStore.getState().toggleComplete("canvas");
    expect(useTutorialStore.getState().completedLessonIds).toContain("canvas");
    useTutorialStore.getState().toggleComplete("canvas");
    expect(useTutorialStore.getState().completedLessonIds).not.toContain(
      "canvas",
    );
  });

  it("ignores an unknown lesson id", () => {
    expect(useTutorialStore.getState().markComplete("not-a-lesson")).toBe(false);
    expect(useTutorialStore.getState().completedLessonIds).toEqual([]);
  });

  it("resets every field", () => {
    useTutorialStore.getState().markComplete("canvas");
    useTutorialStore.getState().setLastLesson("canvas");
    useTutorialStore.getState().setCurrentStep(2);
    useTutorialStore.getState().resetProgress();
    const state = useTutorialStore.getState();
    expect(state.completedLessonIds).toEqual([]);
    expect(state.lastLessonId).toBeNull();
    expect(state.currentStep).toBe(0);
  });
});

describe("TutorialStore resume", () => {
  it("tracks the last lesson and resets the step", () => {
    useTutorialStore.getState().setCurrentStep(3);
    useTutorialStore.getState().setLastLesson("sse");
    const state = useTutorialStore.getState();
    expect(state.lastLessonId).toBe("sse");
    expect(state.currentStep).toBe(0);
  });

  it("ignores an unknown last lesson", () => {
    useTutorialStore.getState().setLastLesson("not-a-lesson");
    expect(useTutorialStore.getState().lastLessonId).toBeNull();
  });

  it("prefers the last lesson, otherwise the first incomplete one", () => {
    const fresh = tutorialResume({
      completedLessonIds: [],
      lastLessonId: null,
      currentStep: 0,
    });
    expect(fresh?.lessonId).toBe("first-workflow");
    expect(fresh?.started).toBe(false);
    expect(fresh?.allComplete).toBe(false);

    const next = tutorialResume({
      completedLessonIds: ["first-workflow"],
      lastLessonId: null,
      currentStep: 0,
    });
    expect(next?.lessonId).toBe("workspaces");
    expect(next?.started).toBe(false);

    const visited = tutorialResume({
      completedLessonIds: [],
      lastLessonId: "sse",
      currentStep: 2,
    });
    expect(visited?.lessonId).toBe("sse");
    expect(visited?.started).toBe(true);
  });

  it("bounds the reported step to the lesson's step count", () => {
    const resume = tutorialResume({
      completedLessonIds: [],
      lastLessonId: "first-workflow",
      currentStep: 999,
    });
    expect(resume?.stepNumber).toBe(resume?.stepCount);
  });

  it("offers a revisit once every lesson is complete", () => {
    const resume = tutorialResume({
      completedLessonIds: TUTORIAL_LESSONS.map((lesson) => lesson.id),
      lastLessonId: "sse",
      currentStep: 0,
    });
    expect(resume).not.toBeNull();
    expect(resume?.allComplete).toBe(true);
    expect(resume?.started).toBe(true);
    expect(resume?.lessonId).toBe("sse");
  });

  it("falls back to the first lesson when all are complete with no last lesson", () => {
    const resume = tutorialResume({
      completedLessonIds: TUTORIAL_LESSONS.map((lesson) => lesson.id),
      lastLessonId: null,
      currentStep: 0,
    });
    expect(resume?.allComplete).toBe(true);
    expect(resume?.lessonId).toBe("first-workflow");
  });

  it("summarises progress", () => {
    expect(tutorialProgressSummary([])).toEqual({ completed: 0, total: TOTAL });
    expect(tutorialProgressSummary(["canvas", "sse"])).toEqual({
      completed: 2,
      total: TOTAL,
    });
  });

  it("points at the next lesson", () => {
    expect(tutorialNextLessonId("first-workflow")).toBe("workspaces");
    expect(tutorialNextLessonId("updates")).toBeNull();
  });
});

describe("TutorialStore storage hardening", () => {
  it("drops unknown ids and duplicates", () => {
    expect(
      sanitizeCompletedLessonIds([
        "canvas",
        "canvas",
        "ghost-lesson",
        7,
        null,
        "sse",
      ]),
    ).toEqual(["canvas", "sse"]);
  });

  it("falls back to empty progress for a malformed blob", () => {
    expect(sanitizeProgress(null)).toEqual({
      completedLessonIds: [],
      lastLessonId: null,
      currentStep: 0,
    });
    expect(sanitizeProgress("nonsense")).toEqual({
      completedLessonIds: [],
      lastLessonId: null,
      currentStep: 0,
    });
    expect(
      sanitizeProgress({
        completedLessonIds: "nope",
        lastLessonId: "ghost",
        currentStep: -5,
      }),
    ).toEqual({
      completedLessonIds: [],
      lastLessonId: null,
      currentStep: 0,
    });
  });

  it("stays usable when setItem throws (quota/security)", () => {
    const original = Object.getOwnPropertyDescriptor(window, "localStorage");
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: () => null,
        setItem: () => {
          throw new Error("QuotaExceededError");
        },
        removeItem: () => {
          throw new Error("QuotaExceededError");
        },
      },
    });

    try {
      expect(() =>
        useTutorialStore.getState().markComplete("canvas"),
      ).not.toThrow();
      expect(useTutorialStore.getState().completedLessonIds).toContain("canvas");
      expect(() =>
        useTutorialStore.getState().setLastLesson("sse"),
      ).not.toThrow();
      expect(useTutorialStore.getState().lastLessonId).toBe("sse");
      expect(() => useTutorialStore.getState().resetProgress()).not.toThrow();
      expect(useTutorialStore.getState().completedLessonIds).toEqual([]);
    } finally {
      if (original !== undefined) {
        Object.defineProperty(window, "localStorage", original);
      }
    }
  });

  it("stays usable when accessing localStorage itself throws", () => {
    const original = Object.getOwnPropertyDescriptor(window, "localStorage");
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw new Error("storage disabled");
      },
    });

    try {
      expect(() =>
        useTutorialStore.getState().markComplete("canvas"),
      ).not.toThrow();
      expect(useTutorialStore.getState().completedLessonIds).toContain("canvas");
    } finally {
      if (original !== undefined) {
        Object.defineProperty(window, "localStorage", original);
      }
    }
  });

  it("survives a malformed persisted JSON blob", async () => {
    localStorage.setItem("apiweave:v1:tutorialProgress", "{not valid json");
    await expect(useTutorialStore.persist.rehydrate()).resolves.not.toThrow();
    expect(useTutorialStore.getState().completedLessonIds).toEqual([]);
    expect(useTutorialStore.getState().lastLessonId).toBeNull();
  });

  it("survives a persisted blob of the wrong shape", async () => {
    localStorage.setItem(
      "apiweave:v1:tutorialProgress",
      JSON.stringify({ state: { completedLessonIds: 42 }, version: 0 }),
    );
    await expect(useTutorialStore.persist.rehydrate()).resolves.not.toThrow();
    expect(useTutorialStore.getState().completedLessonIds).toEqual([]);
  });
});
