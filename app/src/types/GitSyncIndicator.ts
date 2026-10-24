import type { LucideIcon } from "lucide-react";
import type { GitSyncIntent } from "./GitSyncIntent";
import type { GitSyncKind } from "./GitSyncKind";

/**
 * One workspace's sync state as every surface shows it: an icon, a word and the
 * colour they take, all decided in one place so the header, the switcher and
 * Version history cannot disagree.
 */
export interface GitSyncIndicator {
  readonly kind: GitSyncKind;
  /** The short text beside the icon, e.g. "Local history" or "Pending (2 to push)". */
  readonly label: string;
  readonly intent: GitSyncIntent;
  /** The lucide icon for the kind; null for a workspace with no history to report. */
  readonly icon: LucideIcon | null;
}
