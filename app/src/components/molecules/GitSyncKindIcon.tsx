import {
  AlertCircle,
  ArrowDownToLine,
  CheckCircle2,
  CircleDot,
  GitCommitHorizontal,
  GitMerge,
  Lock,
  RefreshCw,
  type LucideIcon,
} from "lucide-react";
import type { GitSyncKind, GitSyncKindIconProps } from "../../types";

const ICONS: Readonly<Record<GitSyncKind, LucideIcon>> = {
  synced: CheckCircle2,
  pending: CircleDot,
  syncing: RefreshCw,
  incoming: ArrowDownToLine,
  merging: GitMerge,
  diverged: GitMerge,
  "read-only": Lock,
  error: AlertCircle,
};

/**
 * One shape per sync state, so the state reads without its colour. A
 * workspace with no remote settles on the commit icon, not the check that
 * says "in sync with something". Decorative: the label beside it says it.
 */
export function GitSyncKindIcon({ kind, local, className = "h-4 w-4" }: GitSyncKindIconProps) {
  const Icon = local && kind === "synced" ? GitCommitHorizontal : ICONS[kind];
  const spin = kind === "syncing" ? "motion-safe:animate-spin" : "";
  return <Icon className={`${className} ${spin}`.trim()} aria-hidden="true" />;
}
