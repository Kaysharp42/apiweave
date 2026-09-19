import { useEffect, useRef } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Check,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  X,
} from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "./atoms/Button";
import { IconButton } from "./atoms/IconButton";
import {
  CanvasControlsClearance,
  CanvasCornerGutter,
} from "../constants/CanvasChrome";
import type { TutorialCompanionProps } from "../types";

/**
 * Where the strip and the floating panel sit: one gutter off the canvas floor,
 * clear of the ReactFlow control column to its left. The max width is measured
 * from those same insets so the panel never overhangs the opposite edge.
 */
const floatStyle = {
  left: CanvasControlsClearance,
  bottom: CanvasCornerGutter,
  maxWidth: `calc(100% - ${CanvasControlsClearance + CanvasCornerGutter}px)`,
} as const;

/** The collapsed resume strip: title, step count, resume and close. */
function TutorialCompanionStrip({
  title,
  stepIndex,
  stepCount,
  onKeyDown,
  onExpand,
  onClose,
}: {
  title: string;
  stepIndex: number;
  stepCount: number;
  onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void;
  onExpand: () => void;
  onClose: () => void;
}) {
  return (
    <div
      onKeyDown={onKeyDown}
      style={{ ...floatStyle, maxWidth: `min(24rem, ${floatStyle.maxWidth})` }}
      className="pointer-events-auto absolute z-30"
    >
      <div className="flex items-center gap-2 rounded-sm border border-border bg-surface-raised px-2 py-1.5 shadow-node dark:border-border-dark dark:bg-surface-dark-raised">
        <BookOpen
          className="h-4 w-4 flex-shrink-0 text-primary dark:text-primary-light"
          aria-hidden="true"
        />
        <span className="min-w-0 flex-1 truncate text-xs text-text-secondary dark:text-text-secondary-dark">
          <span className="font-medium text-text-primary dark:text-text-primary-dark">
            {title}
          </span>{" "}
          · step {stepIndex + 1} of {stepCount}
        </span>
        <Button
          variant="secondary"
          size="xs"
          onClick={onExpand}
          icon={<ChevronUp className="h-3.5 w-3.5" />}
        >
          Resume
        </Button>
        <IconButton
          tooltip="Close follow-along"
          size="xs"
          variant="ghost"
          onClick={onClose}
        >
          <X className="h-3.5 w-3.5" />
        </IconButton>
      </div>
    </div>
  );
}

/** The title bar: collapse (as a back link when covering content) and close. */
function TutorialCompanionHeader({
  isExpandedOverContent,
  onCollapse,
  onClose,
}: {
  isExpandedOverContent: boolean;
  onCollapse: () => void;
  onClose: () => void;
}) {
  return (
    <div className="flex flex-shrink-0 items-center justify-between gap-2 border-b border-border bg-surface-overlay px-3 py-2 dark:border-border-dark dark:bg-surface-dark-overlay">
      <div className="flex min-w-0 items-center gap-2">
        <BookOpen
          className="h-4 w-4 flex-shrink-0 text-primary dark:text-primary-light"
          aria-hidden="true"
        />
        <h2 className="min-w-0 truncate text-sm font-semibold text-text-primary dark:text-text-primary-dark">
          Follow along
        </h2>
      </div>
      <div className="flex flex-shrink-0 items-center gap-1">
        {isExpandedOverContent ? (
          <Button
            variant="ghost"
            size="xs"
            onClick={onCollapse}
            icon={<ArrowLeft className="h-3.5 w-3.5" />}
          >
            Back to workspace
          </Button>
        ) : (
          <IconButton
            tooltip="Collapse follow-along"
            size="xs"
            variant="ghost"
            onClick={onCollapse}
          >
            <ChevronUp className="h-3.5 w-3.5" />
          </IconButton>
        )}
        <IconButton
          tooltip="Close follow-along"
          size="xs"
          variant="ghost"
          onClick={onClose}
        >
          <X className="h-3.5 w-3.5" />
        </IconButton>
      </div>
    </div>
  );
}

/** The lesson title, active step text, expected result, and optional link
 * out to where the step's work happens. */
function TutorialCompanionBody({
  lesson,
  step,
  stepIndex,
  stepCount,
  destinationHref,
}: {
  lesson: TutorialCompanionProps["lesson"];
  step: TutorialCompanionProps["lesson"]["steps"][number];
  stepIndex: number;
  stepCount: number;
  destinationHref: string | undefined;
}) {
  return (
    <div className="min-h-0 min-w-0 flex-1 overflow-y-auto p-3">
      <p className="text-xs font-medium uppercase tracking-wide text-text-secondary dark:text-text-secondary-dark">
        {lesson.title}
      </p>
      <p className="mt-1 text-xs text-text-secondary dark:text-text-secondary-dark">
        Step {stepIndex + 1} of {stepCount}
      </p>

      <h3 className="mt-3 text-sm font-semibold text-text-primary dark:text-text-primary-dark">
        {step.title}
      </h3>
      <p className="mt-1 text-sm leading-relaxed text-text-secondary dark:text-text-secondary-dark">
        {step.instruction}
      </p>
      {step.detail !== undefined && (
        <p className="mt-1.5 text-xs leading-relaxed text-text-secondary dark:text-text-secondary-dark">
          {step.detail}
        </p>
      )}

      <div className="mt-3 rounded-sm border border-border bg-surface-overlay p-2 dark:border-border-dark dark:bg-surface-dark-overlay">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-text-secondary dark:text-text-secondary-dark">
          Lesson result
        </p>
        <p className="mt-0.5 text-xs leading-relaxed text-text-secondary dark:text-text-secondary-dark">
          {lesson.expectedResult}
        </p>
      </div>

      {destinationHref !== undefined && lesson.destination !== undefined && (
        <div className="mt-3">
          <Link
            to={destinationHref}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-[var(--aw-primary)] focus-visible:outline-offset-[var(--aw-focus-ring-offset)] dark:text-primary-light"
          >
            <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
            {lesson.destination.label}
          </Link>
        </div>
      )}
    </div>
  );
}

/**
 * The completion action (mark complete or move to the next lesson), the
 * previous/next step controls, and the full-lesson/return-to-workspace row.
 */
function TutorialCompanionFooter({
  isFirstStep,
  isLastStep,
  isLessonComplete,
  stepIndex,
  stepCount,
  stepTitle,
  previousButtonRef,
  nextButtonRef,
  onPreviousStep,
  onNextStep,
  onOpenLesson,
  onMarkComplete,
  onNextLesson,
  onReturnToWorkspace,
}: {
  isFirstStep: boolean;
  isLastStep: boolean;
  isLessonComplete: boolean;
  stepIndex: number;
  stepCount: number;
  stepTitle: string;
  previousButtonRef: React.RefObject<HTMLButtonElement>;
  nextButtonRef: React.RefObject<HTMLButtonElement>;
  onPreviousStep: () => void;
  onNextStep: () => void;
  onOpenLesson: () => void;
  onMarkComplete: () => void;
  onNextLesson: () => void;
  onReturnToWorkspace: () => void;
}) {
  return (
    <div className="flex flex-shrink-0 flex-col gap-2 border-t border-border bg-surface-overlay px-3 py-2.5 dark:border-border-dark dark:bg-surface-dark-overlay">
      {isLastStep && isLessonComplete && (
        <Button
          variant="primary"
          size="sm"
          fullWidth
          onClick={onNextLesson}
          icon={<ArrowRight className="h-4 w-4" />}
        >
          Next lesson
        </Button>
      )}
      {isLastStep && !isLessonComplete && (
        <Button
          variant="primary"
          intent="success"
          size="sm"
          fullWidth
          onClick={onMarkComplete}
          icon={<Check className="h-4 w-4" />}
        >
          Mark lesson complete
        </Button>
      )}

      <div className="flex items-center justify-between gap-2">
        <Button
          ref={previousButtonRef}
          variant="ghost"
          size="sm"
          disabled={isFirstStep}
          onClick={onPreviousStep}
          icon={<ChevronLeft className="h-4 w-4" />}
        >
          Previous
        </Button>
        {!isLastStep && (
          <Button
            ref={nextButtonRef}
            variant="primary"
            size="sm"
            onClick={onNextStep}
            icon={<ChevronRight className="h-4 w-4" />}
          >
            Next
          </Button>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button variant="ghost" size="xs" onClick={onOpenLesson}>
          Full lesson
        </Button>
        <Button variant="ghost" size="xs" onClick={onReturnToWorkspace}>
          Return to workspace
        </Button>
      </div>

      {/* Polite announcement of the active step. */}
      <span role="status" aria-live="polite" className="sr-only">
        Step {stepIndex + 1} of {stepCount}: {stepTitle}
      </span>
    </div>
  );
}

/**
 * Keep focus on the control the user is using when the step changes: the step
 * buttons are re-rendered under them, and a step change that drops focus to
 * the body strands a keyboard user at the top of the app.
 */
function useTutorialCompanionStepFocus(
  lastActionRef: React.RefObject<"previous" | "next" | null>,
  previousButtonRef: React.RefObject<HTMLButtonElement>,
  nextButtonRef: React.RefObject<HTMLButtonElement>,
  stepIndex: number,
  isLastStep: boolean,
) {
  useEffect(() => {
    const lastAction = lastActionRef.current;
    if (lastAction === null || document.activeElement !== document.body) {
      return;
    }
    const targets = {
      previous: previousButtonRef.current,
      next: nextButtonRef.current,
    };
    targets[lastAction]?.focus();
  }, [lastActionRef, previousButtonRef, nextButtonRef, stepIndex, isLastStep]);
}

/**
 * The follow-along companion: one nonmodal panel that shows the active lesson
 * and step while the user works in the app.
 *
 * Presentation is driven by the measured main-content width. Wide layouts get
 * a floating 20rem panel in the lower-left, leaving the right inspector
 * unobstructed. Compact layouts start as a resume strip and expand the
 * instructions over the content area on request; the caller makes the covered
 * content inert. Exactly one instance is mounted, by `MainLayout`.
 *
 * Branching here is already minimal (two guard clauses, two style ternaries);
 * the remaining complexity score is the 15-field TutorialCompanionProps
 * itself. Grouping those into a synthetic "actions"/"state" object would only
 * relabel the same handlers through an extra layer of indirection.
 */
// fallow-ignore-next-line complexity
export function TutorialCompanion({
  lesson,
  stepIndex,
  isCollapsed,
  isExpandedOverContent,
  isLessonComplete,
  destinationHref,
  onCollapse,
  onExpand,
  onClose,
  onPreviousStep,
  onNextStep,
  onOpenLesson,
  onMarkComplete,
  onNextLesson,
  onReturnToWorkspace,
}: TutorialCompanionProps) {
  const nextButtonRef = useRef<HTMLButtonElement>(null);
  const previousButtonRef = useRef<HTMLButtonElement>(null);

  const stepCount = lesson.steps.length;
  const isFirstStep = stepIndex <= 0;
  const isLastStep = stepIndex >= stepCount - 1;

  const lastActionRef = useRef<"previous" | "next" | null>(null);
  useTutorialCompanionStepFocus(
    lastActionRef,
    previousButtonRef,
    nextButtonRef,
    stepIndex,
    isLastStep,
  );

  // Escape is handled only while focus is inside the companion, so it never
  // competes with the terminal, an editor, or a modal elsewhere in the app.
  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      onCollapse();
    }
  };

  if (isCollapsed) {
    return (
      <TutorialCompanionStrip
        title={lesson.title}
        stepIndex={stepIndex}
        stepCount={stepCount}
        onKeyDown={handleKeyDown}
        onExpand={onExpand}
        onClose={onClose}
      />
    );
  }

  const step = lesson.steps[stepIndex];
  if (step === undefined) return null;

  return (
    <div
      onKeyDown={handleKeyDown}
      role="complementary"
      aria-label="Follow along"
      style={isExpandedOverContent ? undefined : floatStyle}
      className={
        isExpandedOverContent
          ? "absolute inset-0 z-30 flex flex-col bg-surface dark:bg-surface-dark"
          : "absolute z-30 flex w-80 flex-col overflow-hidden rounded-sm border border-border bg-surface-raised shadow-popover dark:border-border-dark dark:bg-surface-dark-raised"
      }
    >
      <TutorialCompanionHeader
        isExpandedOverContent={isExpandedOverContent}
        onCollapse={onCollapse}
        onClose={onClose}
      />

      <TutorialCompanionBody
        lesson={lesson}
        step={step}
        stepIndex={stepIndex}
        stepCount={stepCount}
        destinationHref={destinationHref}
      />

      <TutorialCompanionFooter
        isFirstStep={isFirstStep}
        isLastStep={isLastStep}
        isLessonComplete={isLessonComplete}
        stepIndex={stepIndex}
        stepCount={stepCount}
        stepTitle={step.title}
        previousButtonRef={previousButtonRef}
        nextButtonRef={nextButtonRef}
        onPreviousStep={() => {
          lastActionRef.current = "previous";
          onPreviousStep();
        }}
        onNextStep={() => {
          lastActionRef.current = "next";
          onNextStep();
        }}
        onOpenLesson={onOpenLesson}
        onMarkComplete={onMarkComplete}
        onNextLesson={onNextLesson}
        onReturnToWorkspace={onReturnToWorkspace}
      />
    </div>
  );
}
