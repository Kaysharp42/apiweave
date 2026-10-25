import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { describeMergeNote } from "@shared/git-merge/notes";
import { Button } from "../atoms/Button";
import { countMergeNotes, describeAutomaticMerge } from "../../utils/mergeNotes";
import type { MergeNotesProps } from "../../types";

/**
 * What the merge settled without asking, folded above the conflicts: node
 * positions both copies moved, an order kept, an edge or frame another copy's
 * deletion left dangling. Shown before Finish, because a repair can touch a
 * value the user picked.
 */
export function MergeNotes({ notes }: MergeNotesProps) {
  const [open, setOpen] = useState(false);
  if (notes.length === 0) return null;
  return (
    <section
      aria-label="Merged automatically"
      className="rounded-sm border border-border bg-surface-overlay/40 dark:border-border-dark dark:bg-surface-dark-overlay/40"
    >
      <Button
        variant="ghost"
        size="sm"
        aria-expanded={open}
        icon={
          open ? (
            <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
          )
        }
        onClick={() => setOpen(!open)}
      >
        {describeAutomaticMerge(countMergeNotes(notes))}
      </Button>
      {open && (
        <ul className="space-y-1 border-t border-border px-3 py-2 text-xs text-text-secondary dark:border-border-dark dark:text-text-secondary-dark">
          {notes.map((note, index) => (
            <li key={`${note.type}:${note.recordId}:${index}`}>
              {describeMergeNote(note)}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
