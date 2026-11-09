import type { GitAccountRef } from "@shared/types/GitAccountRef";

export interface GitAvatarProps {
  readonly account: GitAccountRef;
  /** Size, shape and text classes, e.g. `h-8 w-8 rounded-full text-xs`; a circle at 32px by default. */
  readonly className?: string;
}
