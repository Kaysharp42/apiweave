import { describe, expect, it } from "vitest";
import {
  TUTORIAL_CHAPTERS,
  TUTORIAL_LESSONS,
  findTutorialChapter,
  findTutorialLesson,
  firstIncompleteLesson,
  isTutorialLessonId,
  nextTutorialLesson,
  searchTutorialLessons,
  tutorialDestinationHref,
  tutorialLessonHref,
  tutorialLessonTitles,
  tutorialLibraryHref,
  tutorialWorkspaceHref,
} from "./curriculum";

/** The stable ids the plan fixes for later phases. */
const EXPECTED_LESSON_IDS = [
  "first-workflow",
  "workspaces",
  "canvas",
  "http-requests",
  "variables-extractors",
  "placeholders-functions",
  "environments",
  "secrets",
  "assertions",
  "delay-merge",
  "sse",
  "call-workflow",
  "runs-history",
  "visual-debugging",
  "presets",
  "projects",
  "import-export",
  "openapi",
  "curl-har",
  "embedded-agents",
  "mcp",
  "settings",
  "cloud",
  "updates",
] as const;

describe("tutorial curriculum", () => {
  it("ships exactly the planned lesson ids", () => {
    expect(TUTORIAL_LESSONS.map((lesson) => lesson.id)).toEqual([
      ...EXPECTED_LESSON_IDS,
    ]);
  });

  it("gives every lesson a chapter, title, outcome, steps and example", () => {
    for (const lesson of TUTORIAL_LESSONS) {
      expect(lesson.title.length).toBeGreaterThan(0);
      expect(lesson.summary.length).toBeGreaterThan(0);
      expect(lesson.outcome.length).toBeGreaterThan(20);
      expect(lesson.keywords.length).toBeGreaterThan(0);
      expect(lesson.steps.length).toBeGreaterThanOrEqual(5);
      expect(lesson.troubleshooting.length).toBeGreaterThan(0);
      expect(lesson.example.code.length).toBeGreaterThan(0);
      expect(lesson.expectedResult.length).toBeGreaterThan(20);
      expect(
        TUTORIAL_CHAPTERS.some((chapter) => chapter.id === lesson.chapterId),
      ).toBe(true);
    }
  });

  it("resolves every related lesson id to a shipped lesson", () => {
    for (const lesson of TUTORIAL_LESSONS) {
      for (const relatedId of lesson.relatedLessonIds) {
        expect(isTutorialLessonId(relatedId)).toBe(true);
      }
    }
  });

  it("looks up lessons and chapters by id", () => {
    expect(findTutorialLesson("sse")?.title).toContain("SSE");
    expect(findTutorialChapter("sse")?.id).toBe("control-flow");
    expect(findTutorialLesson("nope")).toBeNull();
    expect(findTutorialChapter("nope")).toBeNull();
  });

  it("walks forward through the course and stops at the end", () => {
    expect(nextTutorialLesson("first-workflow")?.id).toBe("workspaces");
    expect(nextTutorialLesson("updates")).toBeNull();
  });

  it("finds the first incomplete lesson", () => {
    const all = new Set(TUTORIAL_LESSONS.map((lesson) => lesson.id));
    all.delete("workspaces");
    expect(firstIncompleteLesson(all)?.id).toBe("workspaces");
    expect(firstIncompleteLesson(new Set())?.id).toBe("first-workflow");
    expect(
      firstIncompleteLesson(new Set(TUTORIAL_LESSONS.map((l) => l.id))),
    ).toBeNull();
  });

  it("covers the audited advanced topics by keyword", () => {
    const keywords = new Set(
      TUTORIAL_LESSONS.flatMap((lesson) => lesson.keywords),
    );
    for (const term of [
      "sse",
      "inheritance",
      "dead letter",
      "dry run",
      "expected status",
      "recursion",
      "provenance",
      "briefing",
      "references only",
      "private networks",
    ]) {
      expect(keywords.has(term)).toBe(true);
    }
  });

  it("describes namespaces as explicit, not resolved by priority", () => {
    const lesson = findTutorialLesson("placeholders-functions");
    const text = [
      lesson?.outcome ?? "",
      ...(lesson?.steps ?? []).flatMap((step) => [
        step.instruction,
        step.detail ?? "",
      ]),
    ].join(" ");
    expect(text).not.toMatch(/secret wins/i);
    expect(text).toMatch(/prefix/i);
  });

  it("gives the first workflow a complete, wired exercise", () => {
    const lesson = findTutorialLesson("first-workflow");
    const steps = lesson?.steps ?? [];
    const text = steps
      .flatMap((step) => [step.instruction, step.detail ?? ""])
      .join(" ");
    // Every edge must be instructed, and the public endpoint must not be
    // promised unconditionally.
    expect(text).toMatch(/Start.*GET/i);
    expect(text).toMatch(/pass handle.*End/i);
    expect(text).not.toMatch(/always returns 200/i);
    expect(lesson?.requiresNetwork).toBe(true);
  });

  it("writes randomChoice without wrapping quotes", () => {
    const lesson = findTutorialLesson("placeholders-functions");
    const text = (lesson?.steps ?? [])
      .flatMap((step) => [step.instruction, step.detail ?? ""])
      .join(" ");
    expect(text).toMatch(/randomChoice\(staging,production,local\)/);
    expect(text).not.toMatch(/randomChoice\("/);
  });

  it("resolves related lesson titles", () => {
    const titles = tutorialLessonTitles(["sse", "canvas", "ghost"]);
    expect(titles["sse"]).toContain("SSE");
    expect(titles["canvas"]).toContain("canvas");
    expect(titles["ghost"]).toBeUndefined();
  });
});

describe("tutorial search", () => {
  it("matches case-insensitively on a title", () => {
    const results = searchTutorialLessons("FIRST WORKFLOW");
    expect(results[0]?.lesson.id).toBe("first-workflow");
  });

  it("finds an advanced topic through lesson content", () => {
    const results = searchTutorialLessons("finish trigger");
    expect(results.map((r) => r.lesson.id)).toContain("sse");
  });

  it("keeps chapter context on every result", () => {
    for (const result of searchTutorialLessons("secret")) {
      expect(result.chapterTitle.length).toBeGreaterThan(0);
      expect(result.matchedFields.length).toBeGreaterThan(0);
    }
  });

  it("returns nothing for a blank query and for a miss", () => {
    expect(searchTutorialLessons("   ")).toHaveLength(0);
    expect(searchTutorialLessons("zzzznotathing")).toHaveLength(0);
  });
});

describe("tutorial destinations", () => {
  it("resolves each destination under the workspace base", () => {
    expect(tutorialDestinationHref("workflows", "personal", "personal")).toBe(
      "/personal/personal/workflows",
    );
    expect(tutorialDestinationHref("secrets", "personal", "personal")).toBe(
      "/personal/personal/settings/secrets",
    );
  });

  it("keeps cloud sync unscoped, matching its top-level route", () => {
    expect(tutorialDestinationHref("cloud-sync", "personal", "personal")).toBe(
      "/cloud/sync",
    );
    expect(tutorialDestinationHref("cloud-sync", "acme", "team")).toBe(
      "/cloud/sync",
    );
  });

  it("builds workspace, library and lesson hrefs", () => {
    expect(tutorialWorkspaceHref("personal", "personal")).toBe(
      "/personal/personal/workflows",
    );
    expect(tutorialLibraryHref("personal", "personal")).toBe(
      "/personal/personal/tutorials",
    );
    expect(tutorialLessonHref("personal", "personal", "sse")).toBe(
      "/personal/personal/tutorials/sse",
    );
  });

  it("points every declared destination at a real route shape", () => {
    for (const lesson of TUTORIAL_LESSONS) {
      if (lesson.destination === undefined) continue;
      const href = tutorialDestinationHref(
        lesson.destination.path,
        "personal",
        "personal",
      );
      const isCloud = lesson.destination.path === "cloud-sync";
      expect(
        href.startsWith("/personal/personal/") || (isCloud && href === "/cloud/sync"),
      ).toBe(true);
    }
  });
});
