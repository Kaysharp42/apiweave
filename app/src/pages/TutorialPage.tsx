import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { RotateCcw } from "lucide-react";
import { Button } from "../components/atoms/Button";
import { ConfirmDialog } from "../components/molecules/ConfirmDialog";
import { EmptyState } from "../components/molecules/EmptyState";
import { TutorialLessonView } from "../components/TutorialLessonView";
import { TutorialLibrary } from "../components/TutorialLibrary";
import { useElementWidth } from "../hooks/useElementWidth";
import {
  TUTORIAL_CHAPTERS,
  findTutorialChapter,
  findTutorialLesson,
  tutorialDestinationHref,
  tutorialLessonHref,
  tutorialLessonTitles,
  tutorialLibraryHref,
  tutorialWorkspaceHref,
} from "../constants/tutorials/curriculum";
import useTutorialStore, {
  tutorialPractice,
  tutorialProgressSummary,
  tutorialResume,
} from "../stores/TutorialStore";
import useTutorialCompanionStore from "../stores/TutorialCompanionStore";
import { useWorkspace } from "../contexts/WorkspaceContext";

/**
 * The width, in CSS pixels, at which the library and article fit side by side.
 * Deliberately measured from the tutorial container rather than the viewport:
 * with the agent dock open at 1440px the content column can be ~638px, and the
 * expanded sidebar at 1024px leaves ~642px — viewport breakpoints would call
 * both of those "wide" and squeeze the article.
 */
const TWO_COLUMN_MIN_WIDTH = 768;

/**
 * The tutorial route. `/tutorials` shows the library; `/tutorials/:lessonId`
 * shows the library beside the lesson on wide layouts, or the lesson alone on
 * compact ones.
 *
 * Search text lives here, not in the library, so a compact round trip through
 * a result and back does not clear it. The library and the article each own a
 * single scroll container.
 */
export function TutorialPage() {
  const params = useParams<{
    orgSlug?: string;
    workspaceSlug?: string;
    lessonId?: string;
  }>();
  const navigate = useNavigate();
  const { currentWorkspace, currentOrg } = useWorkspace();

  const [containerRef, containerWidth] = useElementWidth<HTMLDivElement>();
  const isWide =
    containerWidth !== null && containerWidth >= TWO_COLUMN_MIN_WIDTH;

  const headingRef = useRef<HTMLHeadingElement>(null);
  const libraryHeadingRef = useRef<HTMLHeadingElement>(null);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [query, setQuery] = useState("");

  const completedLessonIds = useTutorialStore((s) => s.completedLessonIds);
  const lastLessonId = useTutorialStore((s) => s.lastLessonId);
  const practiceLessonId = useTutorialStore((s) => s.practiceLessonId);
  const practiceStep = useTutorialStore((s) => s.practiceStep);
  const toggleComplete = useTutorialStore((s) => s.toggleComplete);
  const setLastLesson = useTutorialStore((s) => s.setLastLesson);
  const startPractice = useTutorialStore((s) => s.startPractice);
  const resetProgress = useTutorialStore((s) => s.resetProgress);
  const openCompanion = useTutorialCompanionStore((s) => s.openCompanion);

  const completedSet = useMemo(
    () => new Set(completedLessonIds),
    [completedLessonIds],
  );
  const progress = useMemo(
    () => tutorialProgressSummary(completedLessonIds),
    [completedLessonIds],
  );
  const resume = useMemo(
    () =>
      tutorialResume({
        completedLessonIds,
        lastLessonId,
        practiceLessonId,
        practiceStep,
      }),
    [completedLessonIds, lastLessonId, practiceLessonId, practiceStep],
  );
  const practice = useMemo(
    () =>
      tutorialPractice({
        completedLessonIds,
        lastLessonId,
        practiceLessonId,
        practiceStep,
      }),
    [completedLessonIds, practiceLessonId, practiceStep],
  );

  const orgSlug = currentOrg?.slug ?? params.orgSlug ?? "personal";
  const workspaceSlug =
    currentWorkspace?.slug ?? params.workspaceSlug ?? "personal";
  const libraryHref = tutorialLibraryHref(orgSlug, workspaceSlug);
  const workspaceHref = tutorialWorkspaceHref(orgSlug, workspaceSlug);

  const lessonId = params.lessonId ?? null;
  const lesson = lessonId !== null ? findTutorialLesson(lessonId) : null;
  const chapter = lesson !== null ? findTutorialChapter(lesson.id) : null;
  const lessonNotFound = lessonId !== null && lesson === null;

  const relatedLessonTitles = useMemo(
    () => tutorialLessonTitles(lesson?.relatedLessonIds ?? []),
    [lesson],
  );

  // Record the lesson being read so the resume card can return to it. Unknown
  // ids are ignored by the store, so a bad link cannot corrupt progress.
  useEffect(() => {
    if (lesson !== null) setLastLesson(lesson.id);
  }, [lesson, setLastLesson]);

  // Focus the new content when the lesson identity changes, so keyboard and
  // screen-reader users land at the top. It also recovers focus when the
  // focused element was removed by a layout-threshold remount — but never
  // steals focus on an ordinary resize, where the active element survives.
  const previousLessonIdRef = useRef<string | null>(null);
  useEffect(() => {
    const previousLessonId = previousLessonIdRef.current;
    previousLessonIdRef.current = lessonId;

    const activeElement = document.activeElement;
    const focusWasLost =
      activeElement === null || activeElement === document.body;

    if (previousLessonId === lessonId && !focusWasLost) return;

    if (lesson !== null) {
      headingRef.current?.focus();
    } else {
      libraryHeadingRef.current?.focus();
    }
  }, [lessonId, lesson, isWide]);

  const selectLesson = useCallback(
    (nextLessonId: string) => {
      navigate(tutorialLessonHref(orgSlug, workspaceSlug, nextLessonId));
    },
    [navigate, orgSlug, workspaceSlug],
  );

  const backToLibrary = useCallback(() => {
    navigate(libraryHref);
  }, [navigate, libraryHref]);

  // Start (or resume) the exercise and go where the work happens: the
  // companion is suppressed on the tutorial route, so the reader is taken to
  // the workspace where the instructions float beside the canvas. Nothing is
  // created, run or mutated here.
  const handleFollowAlong = useCallback(
    (targetLessonId: string) => {
      startPractice(targetLessonId);
      openCompanion(workspaceHref);
      navigate(workspaceHref);
    },
    [startPractice, openCompanion, navigate, workspaceHref],
  );

  const destinationHref =
    lesson?.destination !== undefined
      ? tutorialDestinationHref(
          lesson.destination.path,
          orgSlug,
          workspaceSlug,
        )
      : undefined;

  const library = (
    <TutorialLibrary
      chapters={TUTORIAL_CHAPTERS}
      activeLessonId={lessonId}
      completedLessonIds={completedSet}
      lastLessonId={lastLessonId}
      progress={progress}
      resume={resume}
      query={query}
      onQueryChange={setQuery}
      headingRef={libraryHeadingRef}
      onBackToWorkspace={() => navigate(workspaceHref)}
      showBackToWorkspace={!isWide || lesson === null}
      onSelectLesson={selectLesson}
    />
  );

  const backToWorkspace = (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => navigate(workspaceHref)}
    >
      Back to workspace
    </Button>
  );

  const resetButton = (
    <div className="mt-10 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4 dark:border-border-dark">
      {backToWorkspace}
      <Button
        variant="ghost"
        size="sm"
        intent="error"
        icon={<RotateCcw className="h-4 w-4" />}
        onClick={() => setShowResetConfirm(true)}
      >
        Reset progress
      </Button>
    </div>
  );

  const notFound = (
    <div>
      <h1
        ref={libraryHeadingRef}
        tabIndex={-1}
        className="font-display text-2xl font-bold tracking-tight text-text-primary dark:text-text-primary-dark"
      >
        Lesson not found
      </h1>
      <EmptyState
        title="That lesson does not exist"
        description="It may have been removed, or the link may be wrong. Pick one from the library."
        action={
          <Button variant="outline" size="sm" onClick={backToLibrary}>
            All lessons
          </Button>
        }
      />
    </div>
  );

  const selectPrompt = (
    <EmptyState
      title="Pick a lesson"
      description="Choose a lesson from the library to start reading."
    />
  );

  const lessonArticle =
    lesson !== null && chapter !== null ? (
      <TutorialLessonView
        lesson={lesson}
        chapterTitle={chapter.title}
        isComplete={completedSet.has(lesson.id)}
        headingRef={headingRef}
        showBackToLibrary={!isWide}
        libraryHref={libraryHref}
        {...(destinationHref !== undefined ? { destinationHref } : {})}
        onBackToLibrary={backToLibrary}
        onToggleComplete={toggleComplete}
        onSelectLesson={selectLesson}
        relatedLessonTitles={relatedLessonTitles}
        onFollowAlong={handleFollowAlong}
        isInPractice={practice?.lesson.id === lesson.id}
      />
    ) : null;

  return (
    <div
      ref={containerRef}
      className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-surface dark:bg-surface-dark"
    >
      <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
        {isWide ? (
          <>
            <aside className="flex w-72 flex-shrink-0 flex-col overflow-hidden border-r border-border p-4 dark:border-border-dark">
              {library}
            </aside>
            <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
              <div className="mx-auto max-w-[70ch] px-6 py-6">
                {lessonArticle ?? (lessonNotFound ? notFound : selectPrompt)}
                {lessonArticle !== null && resetButton}
              </div>
            </div>
          </>
        ) : lessonArticle !== null ? (
          <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
            <div className="mx-auto max-w-[70ch] px-4 py-6">
              {lessonArticle}
              {resetButton}
            </div>
          </div>
        ) : lessonNotFound ? (
          <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
            <div className="mx-auto max-w-[70ch] px-4 py-6">{notFound}</div>
          </div>
        ) : (
          // The library owns the single scroll container; the page wrapper
          // must not add a second one.
          <div className="min-h-0 min-w-0 flex-1 overflow-hidden p-4">
            <div className="mx-auto h-full max-w-2xl">{library}</div>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={showResetConfirm}
        onClose={() => setShowResetConfirm(false)}
        onConfirm={() => {
          resetProgress();
          setShowResetConfirm(false);
        }}
        title="Reset tutorial progress?"
        message="This clears every completed lesson and the resume position. It does not touch your workflows."
        confirmLabel="Reset"
        cancelLabel="Cancel"
        intent="warning"
      />
    </div>
  );
}

export default TutorialPage;
