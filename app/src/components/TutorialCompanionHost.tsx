import { useEffect, useMemo, useRef, type RefObject } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { TutorialCompanion } from "./TutorialCompanion";
import { useElementWidth } from "../hooks/useElementWidth";
import { useInert } from "../hooks/useInert";
import useTutorialStore, {
  tutorialNextLessonId,
  tutorialPractice,
} from "../stores/TutorialStore";
import useTutorialCompanionStore from "../stores/TutorialCompanionStore";
import { TUTORIAL_COMPANION_MIN_WIDTH } from "../constants/TutorialChrome";
import {
  tutorialDestinationHref,
  tutorialLessonHref,
} from "../constants/tutorials/curriculum";
import { isTutorialRoute } from "../utils/isTutorialRoute";

/**
 * The single follow-along companion, mounted once by `MainLayout` as a stable
 * sibling of the content region.
 *
 * It is presentation-only: it reads the practised lesson and step from the
 * progress store and the open/collapsed state from an ephemeral store. It never
 * creates, mutates, runs or launches anything. Wide layouts float a panel in
 * the lower-left; compact layouts start as a strip and can expand the
 * instructions over the content, which is made inert while covered.
 */
export function TutorialCompanionHost({
  contentRef,
}: {
  readonly contentRef: RefObject<HTMLElement | null>;
}) {
  const location = useLocation();
  const navigate = useNavigate();

  // Measure the content region, not the viewport: the sidebar and agent dock
  // can leave far less room than the viewport suggests.
  const [measureRef, contentWidth] = useElementWidth<HTMLDivElement>();
  const isWide =
    contentWidth !== null && contentWidth >= TUTORIAL_COMPANION_MIN_WIDTH;

  const practiceLessonId = useTutorialStore((s) => s.practiceLessonId);
  const practiceStep = useTutorialStore((s) => s.practiceStep);
  const completedLessonIds = useTutorialStore((s) => s.completedLessonIds);
  const setPracticeStep = useTutorialStore((s) => s.setPracticeStep);
  const startPractice = useTutorialStore((s) => s.startPractice);
  const markComplete = useTutorialStore((s) => s.markComplete);

  const isOpen = useTutorialCompanionStore((s) => s.isOpen);
  const isCollapsed = useTutorialCompanionStore((s) => s.isCollapsed);
  const isExpanded = useTutorialCompanionStore((s) => s.isExpanded);
  const returnPath = useTutorialCompanionStore((s) => s.returnPath);
  const collapseCompanion = useTutorialCompanionStore(
    (s) => s.collapseCompanion,
  );
  const expandCompanion = useTutorialCompanionStore((s) => s.expandCompanion);
  const closeCompanion = useTutorialCompanionStore((s) => s.closeCompanion);
  const pauseCompanion = useTutorialCompanionStore((s) => s.pauseCompanion);

  const companionRef = useRef<HTMLDivElement>(null);

  const practice = useMemo(
    () =>
      tutorialPractice({
        completedLessonIds,
        lastLessonId: null,
        practiceLessonId,
        practiceStep,
      }),
    [completedLessonIds, practiceLessonId, practiceStep],
  );

  // The full tutorial article suppresses the companion but keeps practice, so
  // reading a related lesson never ends the exercise.
  const suppressed = isTutorialRoute(location.pathname);

  // Leaving the shell entirely (Cloud) unmounts this host. Pause rather than
  // keep `isOpen`, so returning does not pop the companion back open.
  useEffect(() => () => pauseCompanion(), [pauseCompanion]);

  // Crossing from wide to compact while focus is in the workspace collapses to
  // the strip instead of covering the content the user is working in. Focus
  // inside the companion is preserved by expanding, so the control the user was
  // on survives the reflow.
  const wasWideRef = useRef(isWide);
  useEffect(() => {
    const shrank = wasWideRef.current && !isWide;
    wasWideRef.current = isWide;
    if (!shrank) return;
    const active = document.activeElement;
    const focusInsideCompanion =
      active !== null && companionRef.current?.contains(active) === true;
    if (focusInsideCompanion) {
      expandCompanion();
    } else {
      collapseCompanion();
    }
  }, [isWide, collapseCompanion, expandCompanion]);

  // On compact layouts, only an explicit expand covers the content; otherwise
  // the companion is a strip. On wide layouts the floating panel is the normal
  // presentation and `isExpanded` is irrelevant.
  const isExpandedOverContent = !isWide && isExpanded && !isCollapsed;
  const showStrip = isCollapsed || (!isWide && !isExpanded);
  useInert(contentRef, isOpen && !suppressed && isExpandedOverContent);

  const segments = (returnPath ?? "/personal/personal").split("/").filter(Boolean);
  const orgSlug = segments[0] ?? "personal";
  const workspaceSlug = segments[1] ?? "personal";

  const visible = isOpen && !suppressed && practice !== null;
  if (!visible) {
    // Still render the measuring node so the width is known before first open.
    return <div ref={measureRef} className="pointer-events-none absolute inset-0 -z-10" aria-hidden="true" />;
  }

  const { lesson, stepIndex } = practice;
  const destinationHref =
    lesson.destination !== undefined
      ? tutorialDestinationHref(lesson.destination.path, orgSlug, workspaceSlug)
      : undefined;

  return (
    <>
      <div ref={measureRef} className="pointer-events-none absolute inset-0 -z-10" aria-hidden="true" />
      <div ref={companionRef} className="contents">
        <TutorialCompanion
          lesson={lesson}
          stepIndex={stepIndex}
          isCollapsed={showStrip}
          isExpandedOverContent={isExpandedOverContent}
          isLessonComplete={completedLessonIds.includes(lesson.id)}
          returnPath={returnPath ?? `/${orgSlug}/${workspaceSlug}/workflows`}
          {...(destinationHref !== undefined ? { destinationHref } : {})}
          onCollapse={collapseCompanion}
          onExpand={expandCompanion}
          onClose={closeCompanion}
          onPreviousStep={() => setPracticeStep(stepIndex - 1)}
          onNextStep={() => setPracticeStep(stepIndex + 1)}
          onOpenLesson={() =>
            navigate(tutorialLessonHref(orgSlug, workspaceSlug, lesson.id))
          }
          onMarkComplete={() => markComplete(lesson.id)}
          onNextLesson={() => {
            const nextId = tutorialNextLessonId(lesson.id);
            if (nextId !== null) startPractice(nextId);
          }}
          onReturnToWorkspace={() =>
            navigate(returnPath ?? `/${orgSlug}/${workspaceSlug}/workflows`)
          }
        />
      </div>
    </>
  );
}

export default TutorialCompanionHost;
