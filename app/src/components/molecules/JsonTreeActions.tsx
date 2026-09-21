import type { ReactNode } from "react";
import type { JsonEditorProps } from "json-edit-react";
import { Copy } from "lucide-react";

/**
 * The hover-row actions in a JSON tree are the only place in the app where a
 * bare icon has to carry a whole feature -- "save this value as a variable" is
 * not something any glyph says on its own. So they are labelled chips, not
 * icons: the row reveals them on hover (`.jer-edit-buttons`), so the words cost
 * nothing until someone is already looking at that row.
 *
 * `font-sans` is not decoration: the tree sets a monospace family on the whole
 * subtree, and prose in JetBrains Mono at 11px is what makes these read as
 * debug output instead of buttons.
 */
export function JsonTreeActionPill({
  icon,
  label,
  muted = false,
}: {
  icon: ReactNode;
  label: string;
  muted?: boolean;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-sans text-[11px] font-medium leading-none tracking-normal whitespace-nowrap transition-colors ${
        muted
          ? "bg-surface-overlay text-text-secondary hover:bg-border/60 dark:bg-surface-dark-overlay dark:text-text-secondary-dark"
          : "bg-primary/10 text-primary hover:bg-primary/20 dark:bg-primary-light/15 dark:text-primary-light dark:hover:bg-primary-light/25"
      }`}
    >
      {icon}
      {label}
    </span>
  );
}

/** Replaces json-edit-react's unlabelled clipboard glyph in every tree. */
export const JSON_TREE_ICONS: NonNullable<JsonEditorProps["icons"]> = {
  copy: (
    <JsonTreeActionPill
      icon={<Copy className="h-3 w-3" aria-hidden="true" />}
      label="Copy"
      muted
    />
  ),
};

/**
 * The library scales its hover buttons 1.2x, which reads as a wobble once they
 * carry text. Applied on the tree's scroll container.
 */
export const JSON_TREE_ACTION_RESET =
  "[&_.jer-copy-pulse:hover]:transform-none [&_.jer-icon:hover]:transform-none [&_.jer-copy-pulse:hover]:opacity-100 [&_.jer-icon:hover]:opacity-100 [&_.jer-edit-buttons]:gap-1.5 [&_.jer-edit-buttons]:ml-2";
