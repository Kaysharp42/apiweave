import type { TutorialStepListProps } from "../../types";

/**
 * A list of tutorial steps. Numbered for instructions (the order matters),
 * plain for troubleshooting (the reader picks the one that matches).
 *
 * Detail text uses the secondary token rather than muted: it carries meaning
 * (a label to look for, a caveat), and the muted role does not clear the body
 * contrast floor.
 */
export function TutorialStepList({
  steps,
  ordered = true,
}: TutorialStepListProps) {
  const List = ordered ? "ol" : "ul";

  return (
    <List className="min-w-0 list-none space-y-3">
      {steps.map((step, index) => (
        <li key={step.title} className="flex min-w-0 gap-3">
          {ordered ? (
            <span
              aria-hidden="true"
              className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border border-border bg-surface-overlay font-mono text-[10px] font-semibold text-text-secondary dark:border-border-dark dark:bg-surface-dark-overlay dark:text-text-secondary-dark"
            >
              {index + 1}
            </span>
          ) : (
            <span
              aria-hidden="true"
              className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-text-secondary dark:bg-text-secondary-dark"
            />
          )}
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-text-primary dark:text-text-primary-dark">
              {step.title}
            </p>
            <p className="mt-0.5 text-sm leading-relaxed text-text-secondary dark:text-text-secondary-dark">
              {step.instruction}
            </p>
            {step.detail !== undefined && (
              <p className="mt-1 text-xs leading-relaxed text-text-secondary dark:text-text-secondary-dark">
                {step.detail}
              </p>
            )}
          </div>
        </li>
      ))}
    </List>
  );
}
