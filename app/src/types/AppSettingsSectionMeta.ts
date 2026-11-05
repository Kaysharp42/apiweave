import type { LucideIcon } from "lucide-react";

/** Static presentation metadata for one app-scoped settings page. */
export interface AppSettingsSectionMeta {
  readonly icon: LucideIcon;
  readonly title: string;
  readonly subtitle: string;
  /** Forms read better narrow; the agent roster needs the room. */
  readonly width: string;
}
