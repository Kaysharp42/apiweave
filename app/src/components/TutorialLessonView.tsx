import {
  ArrowLeft,
  ArrowUpRight,
  BookOpen,
  Check,
  Circle,
  Clock,
  Undo2,
  Wifi,
} from "lucide-react";
import { Link } from "react-router-dom";
import { Badge } from "./atoms/Badge";
import { Button } from "./atoms/Button";
import { TutorialCodeBlock } from "./molecules/TutorialCodeBlock";
import { TutorialStepList } from "./molecules/TutorialStepList";
import type { TutorialLessonViewProps, TutorialSectionProps } from "../types";

function Section({ title, children }: TutorialSectionProps) {
  return (
    <section className="min-w-0 space-y-2">
      <h2 className="font-display text-sm font-semibold uppercase tracking-wide text-text-secondary dark:text-text-secondary-dark">
        {title}
      </h2>
      {children}
    </section>
  );
}

/**
 * The lesson reader: outcome, prerequisites, numbered steps, example, expected
 * result, troubleshooting and related lessons. The heading is the focus target
 * so a route change moves the reader to the top of the new lesson.
 *
 * Every in-app destination is a router `Link`. The desktop build runs on
 * `HashRouter`, where a raw `href` would leave the single-page app and load a
 * document the protocol handler cannot serve.
 */
export function TutorialLessonView({
  lesson,
  chapterTitle,
  isComplete,
  headingRef,
  showBackToLibrary,
  destinationHref,
  libraryHref,
  onBackToLibrary,
  onToggleComplete,
  onSelectLesson,
  relatedLessonTitles,
}: TutorialLessonViewProps) {
  return (
    <article className="min-w-0" aria-labelledby="tutorial-lesson-heading">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {showBackToLibrary && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onBackToLibrary}
            icon={<ArrowLeft className="h-4 w-4" />}
          >
            All lessons
          </Button>
        )}
        <Link
          to={libraryHref}
          className="inline-flex items-center gap-1.5 rounded-sm px-2 py-1 text-xs font-medium text-text-secondary transition-colors hover:bg-surface-overlay hover:text-text-primary focus-visible:outline-2 focus-visible:outline-[var(--aw-primary)] focus-visible:outline-offset-[var(--aw-focus-ring-offset)] dark:text-text-secondary-dark dark:hover:bg-surface-dark-overlay dark:hover:text-text-primary-dark"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          Tutorials
        </Link>
      </div>

      <p className="text-xs font-medium uppercase tracking-wide text-text-secondary dark:text-text-secondary-dark">
        {chapterTitle}
      </p>
      <h1
        id="tutorial-lesson-heading"
        ref={headingRef}
        tabIndex={-1}
        className="mt-1 font-display text-2xl font-bold tracking-tight text-text-primary dark:text-text-primary-dark"
      >
        {lesson.title}
      </h1>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Badge variant={isComplete ? "success" : "secondary"} size="sm">
          {isComplete ? (
            <Check className="h-3 w-3" aria-hidden="true" />
          ) : (
            <Circle className="h-3 w-3" aria-hidden="true" />
          )}
          {isComplete ? "Completed" : "Not completed"}
        </Badge>
        <span className="inline-flex items-center gap-1 text-xs text-text-secondary dark:text-text-secondary-dark">
          <Clock className="h-3.5 w-3.5" aria-hidden="true" />
          {lesson.durationMinutes} min
        </span>
        {lesson.requiresNetwork && (
          <span className="inline-flex items-center gap-1 text-xs text-text-secondary dark:text-text-secondary-dark">
            <Wifi className="h-3.5 w-3.5" aria-hidden="true" />
            Needs internet
          </span>
        )}
      </div>

      <p className="mt-3 text-sm leading-relaxed text-text-secondary dark:text-text-secondary-dark">
        {lesson.summary}
      </p>

      <div className="mt-5 space-y-6">
        <Section title="Outcome">
          <p className="text-sm leading-relaxed text-text-primary dark:text-text-primary-dark">
            {lesson.outcome}
          </p>
        </Section>

        {lesson.prerequisites.length > 0 && (
          <Section title="Before you start">
            <ul className="min-w-0 space-y-1.5">
              {lesson.prerequisites.map((entry) => (
                <li
                  key={entry}
                  className="flex min-w-0 items-start gap-2 text-sm leading-relaxed text-text-secondary dark:text-text-secondary-dark"
                >
                  <span
                    aria-hidden="true"
                    className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-text-secondary dark:bg-text-secondary-dark"
                  />
                  <span className="min-w-0">{entry}</span>
                </li>
              ))}
            </ul>
          </Section>
        )}

        <Section title="Steps">
          <TutorialStepList steps={lesson.steps} ordered />
        </Section>

        <Section title="Example">
          <TutorialCodeBlock example={lesson.example} />
        </Section>

        <Section title="Expected result">
          <p className="text-sm leading-relaxed text-text-primary dark:text-text-primary-dark">
            {lesson.expectedResult}
          </p>
        </Section>

        <Section title="If something goes wrong">
          <TutorialStepList steps={lesson.troubleshooting} ordered={false} />
        </Section>

        {destinationHref !== undefined && lesson.destination !== undefined && (
          <Section title="Go to">
            <Link
              to={destinationHref}
              className="inline-flex items-center gap-1.5 text-sm font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-[var(--aw-primary)] focus-visible:outline-offset-[var(--aw-focus-ring-offset)] dark:text-primary-light"
            >
              <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
              {lesson.destination.label}
            </Link>
          </Section>
        )}

        {lesson.relatedLessonIds.length > 0 && (
          <Section title="Related lessons">
            <div className="flex flex-wrap gap-2">
              {lesson.relatedLessonIds.map((relatedId) => (
                <Button
                  key={relatedId}
                  variant="outline"
                  size="xs"
                  onClick={() => onSelectLesson(relatedId)}
                >
                  {relatedLessonTitles[relatedId] ?? relatedId}
                </Button>
              ))}
            </div>
          </Section>
        )}
      </div>

      <div className="mt-8 flex flex-wrap items-center gap-2 border-t border-border pt-4 dark:border-border-dark">
        <Button
          variant={isComplete ? "outline" : "primary"}
          intent={isComplete ? "default" : "success"}
          size="md"
          onClick={() => onToggleComplete(lesson.id)}
          icon={
            isComplete ? (
              <Undo2 className="h-4 w-4" />
            ) : (
              <Check className="h-4 w-4" />
            )
          }
        >
          {isComplete ? "Mark not complete" : "Mark complete"}
        </Button>
        <span className="inline-flex items-center gap-1.5 text-xs text-text-secondary dark:text-text-secondary-dark">
          <BookOpen className="h-3.5 w-3.5" aria-hidden="true" />
          Progress is stored on this machine.
        </span>
        {/* Announced politely so a keyboard or screen-reader user hears the
            completion change without the whole article re-announcing. */}
        <span role="status" aria-live="polite" className="sr-only">
          {isComplete
            ? `${lesson.title} marked complete.`
            : `${lesson.title} marked not complete.`}
        </span>
      </div>
    </article>
  );
}
