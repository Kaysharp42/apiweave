import type { MergeConflictGroup } from "./MergeConflictGroup";
import type { GitMergePick } from "@shared/types/GitMergePick";

/** The merge view's left list: every conflicted record and file, grouped by kind. */
export interface MergeItemListProps {
  readonly groups: readonly MergeConflictGroup[];
  /** The decisions so far, so each item says how much is settled. */
  readonly picks: ReadonlyMap<string, GitMergePick>;
  /** The item shown in the main pane, as `pickKey(group.recordId, "")`. */
  readonly selectedKey: string | null;
  readonly disabled: boolean;
  readonly onSelect: (group: MergeConflictGroup) => void;
}
