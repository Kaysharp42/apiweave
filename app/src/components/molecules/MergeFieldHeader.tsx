import type { MergeFieldHeaderProps } from "../../types";

/** The heading above one conflicted field, with what the merge cannot settle on its own said plainly. */
export function MergeFieldHeader({ heading, resolved, invalid }: MergeFieldHeaderProps) {
  return (
    <>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-xs font-semibold text-text-primary dark:text-text-primary-dark">
          {heading}
        </p>
        {!resolved && (
          <p className="text-xxs text-status-warning dark:text-[var(--aw-status-warning)]">
            Unresolved
          </p>
        )}
      </div>
      {invalid !== undefined && (
        <p
          role="note"
          className="mt-1 text-xxs text-status-warning dark:text-[var(--aw-status-warning)]"
        >
          {invalid}. Keeping one whole copy is the way out.
        </p>
      )}
    </>
  );
}
