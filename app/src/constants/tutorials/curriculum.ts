import type {
  TutorialChapter,
  TutorialDestinationPath,
  TutorialLesson,
  TutorialSearchField,
  TutorialSearchResult,
} from "../../types";
import { firstStepsChapter } from "./firstSteps";
import { requestsAndDataChapter } from "./requestsAndData";
import { controlFlowChapter } from "./controlFlow";
import { debugAndObserveChapter } from "./debugAndObserve";
import { organizeChapter } from "./organize";
import { agentsChapter } from "./agents";
import { appChapter } from "./app";

/**
 * The bundled tutorial curriculum. Chapters are in reading order and lessons
 * are in the order they should be presented; the library renders this order
 * directly.
 */
export const TUTORIAL_CHAPTERS: readonly TutorialChapter[] = [
  firstStepsChapter,
  requestsAndDataChapter,
  controlFlowChapter,
  debugAndObserveChapter,
  organizeChapter,
  agentsChapter,
  appChapter,
];

/** Every lesson across all chapters, in curriculum order. */
export const TUTORIAL_LESSONS: readonly TutorialLesson[] =
  TUTORIAL_CHAPTERS.flatMap((chapter) => chapter.lessons);

const LESSON_BY_ID = new Map<string, TutorialLesson>(
  TUTORIAL_LESSONS.map((lesson) => [lesson.id, lesson]),
);

/** The chapter that owns a lesson id, or null when the id is unknown. */
export function findTutorialChapter(
  lessonId: string,
): TutorialChapter | null {
  return (
    TUTORIAL_CHAPTERS.find((chapter) =>
      chapter.lessons.some((lesson) => lesson.id === lessonId),
    ) ?? null
  );
}

/** Look up a lesson by its stable id, or null when the id is unknown. */
export function findTutorialLesson(
  lessonId: string,
): TutorialLesson | null {
  return LESSON_BY_ID.get(lessonId) ?? null;
}

/** A map of lesson id to title for a set of ids, skipping unknown ids. */
export function tutorialLessonTitles(
  lessonIds: readonly string[],
): Readonly<Record<string, string>> {
  const titles: Record<string, string> = {};
  for (const id of lessonIds) {
    const lesson = LESSON_BY_ID.get(id);
    if (lesson !== undefined) titles[id] = lesson.title;
  }
  return titles;
}

/** True when a stored value names a lesson that still ships. */
export function isTutorialLessonId(value: string): boolean {
  return LESSON_BY_ID.has(value);
}

/** The lesson that follows `lessonId` in curriculum order, or null at the end. */
export function nextTutorialLesson(
  lessonId: string,
): TutorialLesson | null {
  const index = TUTORIAL_LESSONS.findIndex(
    (lesson) => lesson.id === lessonId,
  );
  if (index < 0 || index + 1 >= TUTORIAL_LESSONS.length) return null;
  return TUTORIAL_LESSONS[index + 1] ?? null;
}

/** The first lesson that is not complete, in curriculum order. */
export function firstIncompleteLesson(
  completedLessonIds: ReadonlySet<string>,
): TutorialLesson | null {
  return (
    TUTORIAL_LESSONS.find((lesson) => !completedLessonIds.has(lesson.id)) ??
    null
  );
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

function normalize(value: string): string {
  return value.toLowerCase();
}

function includes(haystack: string, needle: string): boolean {
  return normalize(haystack).includes(needle);
}

/**
 * Case-insensitive search over titles, summaries, keywords, outcomes, steps,
 * examples, expected results, troubleshooting and prerequisites. Results keep
 * their chapter context and record which fields matched.
 */
/**
 * One entry per searchable field, in the order results should report matches.
 * Table-driven so `searchTutorialLessons` itself stays a plain nested loop
 * rather than a nine-branch if-chain.
 */
const SEARCH_FIELD_MATCHERS: readonly {
  field: TutorialSearchField;
  matches: (lesson: TutorialLesson, needle: string) => boolean;
}[] = [
  { field: "title", matches: (lesson, needle) => includes(lesson.title, needle) },
  {
    field: "summary",
    matches: (lesson, needle) => includes(lesson.summary, needle),
  },
  {
    field: "keyword",
    matches: (lesson, needle) =>
      lesson.keywords.some((keyword) => includes(keyword, needle)),
  },
  {
    field: "outcome",
    matches: (lesson, needle) => includes(lesson.outcome, needle),
  },
  {
    field: "prerequisite",
    matches: (lesson, needle) =>
      lesson.prerequisites.some((entry) => includes(entry, needle)),
  },
  {
    field: "step",
    matches: (lesson, needle) =>
      lesson.steps.some(
        (step) =>
          includes(step.title, needle) ||
          includes(step.instruction, needle) ||
          (step.detail !== undefined && includes(step.detail, needle)),
      ),
  },
  {
    field: "example",
    matches: (lesson, needle) =>
      includes(lesson.example.caption, needle) ||
      includes(lesson.example.code, needle),
  },
  {
    field: "expected",
    matches: (lesson, needle) => includes(lesson.expectedResult, needle),
  },
  {
    field: "troubleshooting",
    matches: (lesson, needle) =>
      lesson.troubleshooting.some(
        (entry) =>
          includes(entry.title, needle) || includes(entry.instruction, needle),
      ),
  },
];

function matchedSearchFields(
  lesson: TutorialLesson,
  needle: string,
): TutorialSearchField[] {
  return SEARCH_FIELD_MATCHERS.filter((matcher) =>
    matcher.matches(lesson, needle),
  ).map((matcher) => matcher.field);
}

export function searchTutorialLessons(
  query: string,
): readonly TutorialSearchResult[] {
  const needle = normalize(query.trim());
  if (!needle) return [];

  const results: TutorialSearchResult[] = [];

  for (const chapter of TUTORIAL_CHAPTERS) {
    for (const lesson of chapter.lessons) {
      const matchedFields = matchedSearchFields(lesson, needle);
      if (matchedFields.length > 0) {
        results.push({
          lesson,
          chapterId: chapter.id,
          chapterTitle: chapter.title,
          matchedFields,
        });
      }
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Destinations
// ---------------------------------------------------------------------------

/**
 * Resolve a verified destination to an in-app path. `orgSlug` comes from the
 * route (the app has no organizations, so it is typically `personal`), and
 * `workspaceSlug` from the route or the current workspace.
 *
 * Workspace-scoped destinations use the org-prefixed route shape the rest of
 * the app already navigates with. `cloud-sync` is deliberately *not* scoped:
 * its route is a top-level `/cloud/sync`, and prefixing it would navigate to a
 * path the router does not match.
 */
export function tutorialDestinationHref(
  path: TutorialDestinationPath,
  orgSlug: string,
  workspaceSlug: string,
): string {
  const base = `/${orgSlug}/${workspaceSlug}`;
  switch (path) {
    case "workflows":
      return `${base}/workflows`;
    case "environments":
      return `${base}/settings/environments`;
    case "secrets":
      return `${base}/settings/secrets`;
    case "agents":
      return `${base}/settings/agents`;
    case "canvas-settings":
      return `${base}/settings/canvas`;
    case "private-networks":
      return `${base}/settings/private-networks`;
    case "mcp-server":
      return `${base}/settings/mcp-server`;
    case "updates":
      return `${base}/settings/updates`;
    case "cloud-sync":
      return "/cloud/sync";
  }
}

/** The workspace's workflow list — the reader's way back to the canvas. */
export function tutorialWorkspaceHref(
  orgSlug: string,
  workspaceSlug: string,
): string {
  return `/${orgSlug}/${workspaceSlug}/workflows`;
}

/** The tutorial library route. */
export function tutorialLibraryHref(
  orgSlug: string,
  workspaceSlug: string,
): string {
  return `/${orgSlug}/${workspaceSlug}/tutorials`;
}

/** The lesson reader route. */
export function tutorialLessonHref(
  orgSlug: string,
  workspaceSlug: string,
  lessonId: string,
): string {
  return `/${orgSlug}/${workspaceSlug}/tutorials/${lessonId}`;
}
