import { beforeEach, describe, expect, it } from "vitest";
import useTutorialStore, {
  sanitizeCompletedLessonIds,
  sanitizeProgress,
  tutorialNextLessonId,
  tutorialPractice,
  tutorialProgressSummary,
  tutorialResume,
} from "./TutorialStore";
import { TUTORIAL_LESSONS } from "../constants/tutorials/curriculum";
import type { TutorialProgress } from "../types";

const TOTAL = TUTORIAL_LESSONS.length;

/** A progress blob with the fields a test does not care about left empty. */
function progress(
  overrides: Partial<TutorialProgress> = {},
): TutorialProgress {
  return {
    completedLessonIds: [],
    lastLessonId: null,
    practiceLessonId: null,
    practiceStep: 0,
    ...overrides,
  };
}

beforeEach(() => {
  useTutorialStore.getState().resetProgress();
  localStorage.clear();
});

describe("TutorialStore completion", () => {
  it("marks a lesson complete once and reverses it", () => {
    const store = useTutorialStore.getState();
    store.markComplete("first-workflow");
    store.markComplete("first-workflow");
    expect(useTutorialStore.getState().completedLessonIds).toEqual([
      "first-workflow",
    ]);

    useTutorialStore.getState().markIncomplete("first-workflow");
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
    useTutorialStore.getState().markComplete("not-a-lesson");
    expect(useTutorialStore.getState().completedLessonIds).toEqual([]);
  });

  it("resets every field", () => {
    useTutorialStore.getState().markComplete("canvas");
    useTutorialStore.getState().setLastLesson("canvas");
    useTutorialStore.getState().startPractice("canvas");
    useTutorialStore.getState().setPracticeStep(2);
    useTutorialStore.getState().resetProgress();
    const state = useTutorialStore.getState();
    expect(state.completedLessonIds).toEqual([]);
    expect(state.lastLessonId).toBeNull();
    expect(state.practiceLessonId).toBeNull();
    expect(state.practiceStep).toBe(0);
  });
});

describe("TutorialStore reading position", () => {
  it("tracks the last lesson without touching practice", () => {
    useTutorialStore.getState().startPractice("sse");
    useTutorialStore.getState().setPracticeStep(3);
    useTutorialStore.getState().setLastLesson("canvas");

    const state = useTutorialStore.getState();
    expect(state.lastLessonId).toBe("canvas");
    // Reading a different lesson never moves the active exercise.
    expect(state.practiceLessonId).toBe("sse");
    expect(state.practiceStep).toBe(3);
  });

  it("ignores an unknown last lesson", () => {
    useTutorialStore.getState().setLastLesson("not-a-lesson");
    expect(useTutorialStore.getState().lastLessonId).toBeNull();
  });

  it("prefers the last lesson, otherwise the first incomplete one", () => {
    const fresh = tutorialResume(progress());
    expect(fresh?.lessonId).toBe("first-workflow");
    expect(fresh?.started).toBe(false);
    expect(fresh?.allComplete).toBe(false);

    const next = tutorialResume(
      progress({ completedLessonIds: ["first-workflow"] }),
    );
    expect(next?.lessonId).toBe("workspaces");
    expect(next?.started).toBe(false);

    const visited = tutorialResume(progress({ lastLessonId: "sse" }));
    expect(visited?.lessonId).toBe("sse");
    expect(visited?.started).toBe(true);
  });

  it("offers a revisit once every lesson is complete", () => {
    const resume = tutorialResume(
      progress({
        completedLessonIds: TUTORIAL_LESSONS.map((lesson) => lesson.id),
        lastLessonId: "sse",
      }),
    );
    expect(resume).not.toBeNull();
    expect(resume?.allComplete).toBe(true);
    expect(resume?.started).toBe(true);
    expect(resume?.lessonId).toBe("sse");
  });

  it("falls back to the first lesson when all are complete with no last lesson", () => {
    const resume = tutorialResume(
      progress({
        completedLessonIds: TUTORIAL_LESSONS.map((lesson) => lesson.id),
      }),
    );
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

describe("TutorialStore practice", () => {
  it("starts a new exercise at step zero", () => {
    useTutorialStore.getState().startPractice("first-workflow");
    const state = useTutorialStore.getState();
    expect(state.practiceLessonId).toBe("first-workflow");
    expect(state.practiceStep).toBe(0);
  });

  it("resumes the same exercise at its existing step", () => {
    useTutorialStore.getState().startPractice("first-workflow");
    useTutorialStore.getState().setPracticeStep(3);
    useTutorialStore.getState().startPractice("first-workflow");
    expect(useTutorialStore.getState().practiceStep).toBe(3);
  });

  it("resets the step when switching to a different exercise", () => {
    useTutorialStore.getState().startPractice("first-workflow");
    useTutorialStore.getState().setPracticeStep(3);
    useTutorialStore.getState().startPractice("sse");
    const state = useTutorialStore.getState();
    expect(state.practiceLessonId).toBe("sse");
    expect(state.practiceStep).toBe(0);
  });

  it("ignores an unknown practice lesson", () => {
    useTutorialStore.getState().startPractice("not-a-lesson");
    expect(useTutorialStore.getState().practiceLessonId).toBeNull();
  });

  it("clamps the practice step to the lesson bounds", () => {
    useTutorialStore.getState().startPractice("first-workflow");
    const stepCount =
      TUTORIAL_LESSONS.find((l) => l.id === "first-workflow")?.steps.length ?? 0;

    useTutorialStore.getState().setPracticeStep(-5);
    expect(useTutorialStore.getState().practiceStep).toBe(0);

    useTutorialStore.getState().setPracticeStep(999);
    expect(useTutorialStore.getState().practiceStep).toBe(stepCount - 1);
  });

  it("does nothing to the step when no exercise is active", () => {
    useTutorialStore.getState().setPracticeStep(3);
    expect(useTutorialStore.getState().practiceStep).toBe(0);
  });

  it("ends practice without touching completions or reading", () => {
    useTutorialStore.getState().markComplete("canvas");
    useTutorialStore.getState().setLastLesson("canvas");
    useTutorialStore.getState().startPractice("canvas");
    useTutorialStore.getState().endPractice();

    const state = useTutorialStore.getState();
    expect(state.practiceLessonId).toBeNull();
    expect(state.practiceStep).toBe(0);
    expect(state.completedLessonIds).toContain("canvas");
    expect(state.lastLessonId).toBe("canvas");
  });

  it("resolves the active step for the companion", () => {
    useTutorialStore.getState().startPractice("first-workflow");
    useTutorialStore.getState().setPracticeStep(1);
    const practice = tutorialPractice(
      useTutorialStore.getState() as TutorialProgress,
    );
    expect(practice?.lesson.id).toBe("first-workflow");
    expect(practice?.stepNumber).toBe(2);
    expect(practice?.stepCount).toBeGreaterThan(1);
    expect(practice?.instruction.length).toBeGreaterThan(0);
  });

  it("resolves no practice when none is active", () => {
    expect(tutorialPractice(progress())).toBeNull();
  });

  it("clamps a stale stored step during hydration", () => {
    const practice = tutorialPractice(
      progress({ practiceLessonId: "first-workflow", practiceStep: 999 }),
    );
    expect(practice?.stepIndex).toBe(practice ? practice.stepCount - 1 : -1);
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
    const empty = {
      completedLessonIds: [],
      lastLessonId: null,
      practiceLessonId: null,
      practiceStep: 0,
    };
    expect(sanitizeProgress(null)).toEqual(empty);
    expect(sanitizeProgress("nonsense")).toEqual(empty);
    expect(
      sanitizeProgress({
        completedLessonIds: "nope",
        lastLessonId: "ghost",
        practiceLessonId: 42,
        practiceStep: -5,
      }),
    ).toEqual(empty);
  });

  it("ignores the removed currentStep field", () => {
    const sanitized = sanitizeProgress({
      completedLessonIds: ["canvas"],
      lastLessonId: "canvas",
      currentStep: 7,
    });
    expect(sanitized).toEqual({
      completedLessonIds: ["canvas"],
      lastLessonId: "canvas",
      practiceLessonId: null,
      practiceStep: 0,
    });
    expect("currentStep" in sanitized).toBe(false);
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
        useTutorialStore.getState().startPractice("canvas"),
      ).not.toThrow();
      expect(() =>
        useTutorialStore.getState().setPracticeStep(2),
      ).not.toThrow();
      expect(useTutorialStore.getState().practiceLessonId).toBe("canvas");
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
    expect(useTutorialStore.getState().practiceLessonId).toBeNull();
  });

  it("survives a persisted blob of the wrong shape", async () => {
    localStorage.setItem(
      "apiweave:v1:tutorialProgress",
      JSON.stringify({ state: { completedLessonIds: 42 }, version: 0 }),
    );
    await expect(useTutorialStore.persist.rehydrate()).resolves.not.toThrow();
    expect(useTutorialStore.getState().completedLessonIds).toEqual([]);
  });

  it("restores a stored practice position with a clamped step", async () => {
    localStorage.setItem(
      "apiweave:v1:tutorialProgress",
      JSON.stringify({
        state: {
          completedLessonIds: [],
          lastLessonId: "sse",
          practiceLessonId: "first-workflow",
          practiceStep: 999,
        },
        version: 0,
      }),
    );
    await useTutorialStore.persist.rehydrate();
    const state = useTutorialStore.getState();
    expect(state.lastLessonId).toBe("sse");
    expect(state.practiceLessonId).toBe("first-workflow");
    const lesson = TUTORIAL_LESSONS.find((l) => l.id === "first-workflow");
    expect(state.practiceStep).toBe((lesson?.steps.length ?? 1) - 1);
  });
});
