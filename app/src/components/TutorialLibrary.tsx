import { useMemo } from "react";
import { BookOpen, Check, Circle, CircleDot, Search } from "lucide-react";
import { Button } from "./atoms/Button";
import { Card } from "./molecules/Card";
import { EmptyState } from "./molecules/EmptyState";
import { SearchInput } from "./molecules/SearchInput";
import { searchTutorialLessons } from "../constants/tutorials/curriculum";
import type { LessonRowProps, TutorialLibraryProps } from "../types";

/**
 * One lesson row. Completed shows a check; the lesson the reader last opened
 * and has not finished shows an in-progress dot; everything else is not
 * started. Titles wrap rather than truncate so a long title stays readable in
 * a narrow library.
 */
function LessonRow({
  lesson,
  isComplete,
  isActive,
  onSelect,
  context,
  summary,
  inProgress = false,
}: LessonRowProps & { readonly inProgress?: boolean }) {
  const status = isComplete ? "Completed" : inProgress ? "In progress" : "Not started";
  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(lesson.id)}
        aria-current={isActive ? "page" : undefined}
        className={[
          "flex w-full items-start gap-2 rounded-sm border px-2.5 py-2 text-left transition-colors duration-[var(--aw-transition-fast)]",
          "focus-visible:outline-2 focus-visible:outline-[var(--aw-primary)] focus-visible:outline-offset-[var(--aw-focus-ring-offset)]",
          isActive
            ? "border-primary bg-primary/5 dark:border-primary-light dark:bg-primary-light/10"
            : "border-transparent hover:border-border hover:bg-surface-overlay dark:hover:border-border-dark dark:hover:bg-surface-dark-overlay",
        ].join(" ")}
      >
        <span className="mt-0.5 flex-shrink-0" aria-hidden="true">
          {isComplete ? (
            <Check className="h-4 w-4 text-status-success dark:text-[var(--aw-status-success)]" />
          ) : inProgress ? (
            <CircleDot className="h-4 w-4 text-primary dark:text-primary-light" />
          ) : (
            <Circle className="h-4 w-4 text-text-secondary dark:text-text-secondary-dark" />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium leading-snug text-text-primary dark:text-text-primary-dark">
            {lesson.title}
          </span>
          <span className="mt-0.5 block text-[11px] text-text-secondary dark:text-text-secondary-dark">
            {summary ?? `${status} · ${lesson.durationMinutes} min`}
          </span>
          {context !== undefined && (
            <span className="mt-0.5 block text-[11px] text-text-secondary dark:text-text-secondary-dark">
              {context}
            </span>
          )}
        </span>
      </button>
    </li>
  );
}

function ChapterOutline({
  chapters,
  activeLessonId,
  completedLessonIds,
  lastLessonId,
  onSelectLesson,
}: {
  readonly chapters: TutorialLibraryProps["chapters"];
  readonly activeLessonId: string | null;
  readonly completedLessonIds: ReadonlySet<string>;
  readonly lastLessonId: string | null;
  readonly onSelectLesson: (lessonId: string) => void;
}) {
  return (
    <nav aria-label="Lessons">
      {chapters.map((chapter) => (
        <div key={chapter.id} className="mb-4">
          <h2 className="px-2.5 pb-1 text-[11px] font-semibold uppercase tracking-wider text-text-secondary dark:text-text-secondary-dark">
            {chapter.title}
          </h2>
          <ul className="space-y-0.5">
            {chapter.lessons.map((lesson) => (
              <LessonRow
                key={lesson.id}
                lesson={lesson}
                isComplete={completedLessonIds.has(lesson.id)}
                inProgress={
                  !completedLessonIds.has(lesson.id) &&
                  lesson.id === lastLessonId
                }
                isActive={lesson.id === activeLessonId}
                onSelect={onSelectLesson}
              />
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}

/**
 * The searchable lesson library. On wide layouts it sits beside the article;
 * on compact layouts it is the whole view.
 *
 * The search text is owned by the page (not local state) so a compact trip
 * from a search result into the lesson and back through "All lessons" does not
 * silently clear the query. The whole library — resume card, results and the
 * offline note — shares one scroll container, so nothing is pinned out of
 * reach in a short window.
 */
export function TutorialLibrary({
  chapters,
  activeLessonId,
  completedLessonIds,
  progress,
  resume,
  query,
  onQueryChange,
  headingRef,
  lastLessonId,
  onBackToWorkspace,
  showBackToWorkspace = true,
  onSelectLesson,
}: TutorialLibraryProps) {
  const results = useMemo(() => searchTutorialLessons(query), [query]);
  const isSearching = query.trim().length > 0;

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      <div className="flex-shrink-0 space-y-3 pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h1
              ref={headingRef}
              tabIndex={-1}
              className="font-display text-2xl font-bold tracking-tight text-text-primary dark:text-text-primary-dark"
            >
              Tutorials
            </h1>
            <p className="mt-1 text-sm text-text-secondary dark:text-text-secondary-dark">
              Learn the workflow, one feature at a time.
            </p>
            <p className="mt-1 text-xs text-text-secondary dark:text-text-secondary-dark">
              {progress.completed} of {progress.total} completed
            </p>
          </div>
          {showBackToWorkspace && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onBackToWorkspace}
              className="flex-shrink-0"
            >
              Back to workspace
            </Button>
          )}
        </div>
        <SearchInput
          value={query}
          onChange={onQueryChange}
          placeholder="Search lessons…"
          size="sm"
          aria-label="Search lessons"
        />
      </div>

      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto pb-4">
        {resume !== null && !isSearching && (
          <div className="mb-4">
            <Card
              title={
                resume.allComplete
                  ? "You've finished every lesson"
                  : resume.started
                    ? "Continue where you left off"
                    : "Start here"
              }
            >
              <div className="min-w-0">
                <p className="text-sm font-medium text-text-primary dark:text-text-primary-dark">
                  {resume.title}
                </p>
                <p className="mt-0.5 text-xs text-text-secondary dark:text-text-secondary-dark">
                  {resume.allComplete
                    ? "Revisit any lesson whenever you like."
                    : `Step ${resume.stepNumber} of ${resume.stepCount}`}
                </p>
                <Button
                  variant="primary"
                  size="sm"
                  className="mt-2"
                  onClick={() => onSelectLesson(resume.lessonId)}
                >
                  {resume.allComplete
                    ? "Revisit lesson"
                    : resume.started
                      ? "Continue"
                      : "Start lesson"}
                </Button>
              </div>
            </Card>
          </div>
        )}

        {isSearching ? (
          results.length > 0 ? (
            <div>
              <p className="px-2.5 pb-2 text-xs text-text-secondary dark:text-text-secondary-dark">
                {results.length} {results.length === 1 ? "lesson" : "lessons"}{" "}
                match “{query.trim()}”.
              </p>
              <ul className="space-y-0.5">
                {results.map((result) => (
                  <LessonRow
                    key={result.lesson.id}
                    lesson={result.lesson}
                    isComplete={completedLessonIds.has(result.lesson.id)}
                    isActive={result.lesson.id === activeLessonId}
                    onSelect={onSelectLesson}
                    context={result.chapterTitle}
                    summary={result.lesson.summary}
                  />
                ))}
              </ul>
            </div>
          ) : (
            <EmptyState
              icon={
                <Search
                  className="h-10 w-10 text-text-secondary dark:text-text-secondary-dark"
                  strokeWidth={1.5}
                  aria-hidden="true"
                />
              }
              title="No lessons match"
              description="Try a different term, or clear the search to browse every chapter."
              action={
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onQueryChange("")}
                >
                  Clear search
                </Button>
              }
            />
          )
        ) : (
          <ChapterOutline
            chapters={chapters}
            activeLessonId={activeLessonId}
            completedLessonIds={completedLessonIds}
            lastLessonId={lastLessonId}
            onSelectLesson={onSelectLesson}
          />
        )}

        <p className="mt-4 inline-flex items-center gap-1.5 px-2.5 text-[11px] text-text-secondary dark:text-text-secondary-dark">
          <BookOpen className="h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
          Lessons are bundled and readable offline.
        </p>
      </div>
    </div>
  );
}
