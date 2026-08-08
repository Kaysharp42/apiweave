import type { LucideIcon } from "lucide-react";

export interface NodeModalShellTab {
  key: string;
  label: string;
  icon: LucideIcon;
  /** Count pill shown after the label, e.g. how many extractors a tab holds. */
  badge?: number;
}
