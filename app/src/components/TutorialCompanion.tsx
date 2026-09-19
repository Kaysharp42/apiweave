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

/**
 * The follow-along companion: one nonmodal panel that shows the active lesson
 * and step while the user works in the app.
 *
 * Presentation is driven by the measured main-content width. Wide layouts get
 * a floating 20rem panel in the lower-left, leaving the right inspector
 * unobstructed. Compact layouts start as a resume strip and expand the
 * instructions over the content area on request; the caller makes the covered
 * content inert. Exactly one instance is mounted, by `MainLayout`.
 */
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

  // Keep focus on the control the user is using when the step changes: the
  // step buttons are re-rendered under them, and a step change that drops
  // focus to the body strands a keyboard user at the top of the app.
  const lastActionRef = useRef<"previous" | "next" | null>(null);
  useEffect(() => {
    const target =
      lastActionRef.current === "previous"
        ? previousButtonRef.current
        : lastActionRef.current === "next"
          ? nextButtonRef.current
          : null;
    if (target !== null && document.activeElement === document.body) {
      target.focus();
    }
  }, [stepIndex, isLastStep]);

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
      <div
        onKeyDown={handleKeyDown}
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
              {lesson.title}
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

      <div className="flex flex-shrink-0 flex-col gap-2 border-t border-border bg-surface-overlay px-3 py-2.5 dark:border-border-dark dark:bg-surface-dark-overlay">
        {isLastStep ? (
          isLessonComplete ? (
            <Button
              variant="primary"
              size="sm"
              fullWidth
              onClick={onNextLesson}
              icon={<ArrowRight className="h-4 w-4" />}
            >
              Next lesson
            </Button>
          ) : (
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
          )
        ) : null}

        <div className="flex items-center justify-between gap-2">
          <Button
            ref={previousButtonRef}
            variant="ghost"
            size="sm"
            disabled={isFirstStep}
            onClick={() => {
              lastActionRef.current = "previous";
              onPreviousStep();
            }}
            icon={<ChevronLeft className="h-4 w-4" />}
          >
            Previous
          </Button>
          {!isLastStep && (
            <Button
              ref={nextButtonRef}
              variant="primary"
              size="sm"
              onClick={() => {
                lastActionRef.current = "next";
                onNextStep();
              }}
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
          Step {stepIndex + 1} of {stepCount}: {step.title}
        </span>
      </div>
    </div>
  );
}
