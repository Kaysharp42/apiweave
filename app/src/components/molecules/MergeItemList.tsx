import { useRef } from "react";
import { Check, CircleAlert } from "lucide-react";
import type { GitMergeConflict } from "@shared/types/GitMergeConflict";
import { Badge } from "../atoms/Badge";
import { groupResolvedCount, pickKey } from "../../utils/mergePicks";
import type { MergeItemListProps } from "../../types";

/** The kinds in the order the list shows them, with the heading each gets. */
const SECTIONS: readonly {
  readonly kind: GitMergeConflict["kind"];
  readonly label: string;
}[] = [
  { kind: "workspace", label: "Workspace" },
  { kind: "project", label: "Projects" },
  { kind: "workflow", label: "Workflows" },
  { kind: "environment", label: "Environments" },
  { kind: "file", label: "Files" },
];

/**
 * The conflicted records and files, grouped by kind, each with its name, how
 * many conflicts it holds and whether it is settled. A navigation list of
 * buttons: Tab reaches each, the arrow keys move between them, and the one
 * shown in the main pane carries `aria-current`.
 */
export function MergeItemList({
  groups,
  picks,
  selectedKey,
  disabled,
  onSelect,
}: MergeItemListProps) {
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  const flat = SECTIONS.flatMap((section) =>
    groups.filter((group) => group.kind === section.kind),
  );

  const move = (from: number, by: 1 | -1): void => {
    const next = buttons.current[(from + by + flat.length) % flat.length];
    next?.focus();
  };

  return (
    <nav
      aria-label="Conflicted items"
      className="min-h-0 overflow-y-auto border-r border-border bg-surface-overlay/40 p-2 dark:border-border-dark dark:bg-surface-dark-overlay/40"
    >
      {SECTIONS.map((section) => {
        const listed = flat.filter((group) => group.kind === section.kind);
        if (listed.length === 0) return null;
        return (
          <section key={section.kind} className="mb-3">
            <h3 className="px-2 py-1 text-xxs font-semibold uppercase tracking-wider text-text-muted dark:text-text-muted-dark">
              {section.label}
            </h3>
            <ul className="space-y-1">
              {listed.map((group) => {
                const key = pickKey(group.recordId, "");
                const index = flat.indexOf(group);
                const resolved = groupResolvedCount(group, picks);
                const settled = resolved === group.conflicts.length;
                return (
                  <li key={key}>
                    <button
                      ref={(element) => {
                        buttons.current[index] = element;
                      }}
                      type="button"
                      disabled={disabled}
                      aria-current={key === selectedKey ? "true" : undefined}
                      aria-label={`${group.name}, ${section.label}, ${resolved} of ${group.conflicts.length} conflicts settled`}
                      onClick={() => onSelect(group)}
                      onKeyDown={(event) => {
                        if (event.key === "ArrowDown") {
                          event.preventDefault();
                          move(index, 1);
                        } else if (event.key === "ArrowUp") {
                          event.preventDefault();
                          move(index, -1);
                        }
                      }}
                      className={[
                        "w-full rounded-sm border px-2 py-1.5 text-left transition-colors",
                        "focus-visible:outline-2 focus-visible:outline-[var(--aw-primary)] focus-visible:outline-offset-[var(--aw-focus-ring-offset)]",
                        key === selectedKey
                          ? "border-primary bg-surface-raised dark:border-primary-light dark:bg-surface-dark-raised"
                          : "border-transparent hover:border-border hover:bg-surface-raised dark:hover:border-border-dark dark:hover:bg-surface-dark-raised",
                        disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer",
                      ].join(" ")}
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="min-w-0 truncate text-xs font-medium text-text-primary dark:text-text-primary-dark">
                          {group.name}
                        </span>
                        <Badge variant="secondary" size="xs">
                          {group.conflicts.length}
                        </Badge>
                      </span>
                      <span className="mt-1 flex items-center gap-1">
                        {settled ? (
                          <>
                            <Check
                              className="h-3 w-3 text-status-success dark:text-[var(--aw-status-success)]"
                              aria-hidden="true"
                            />
                            <span className="text-xxs text-text-secondary dark:text-text-secondary-dark">
                              Resolved
                            </span>
                          </>
                        ) : (
                          <>
                            <CircleAlert
                              className="h-3 w-3 text-status-warning dark:text-[var(--aw-status-warning)]"
                              aria-hidden="true"
                            />
                            <span className="text-xxs text-text-secondary dark:text-text-secondary-dark">
                              {group.conflicts.length - resolved} left
                            </span>
                          </>
                        )}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </nav>
  );
}
