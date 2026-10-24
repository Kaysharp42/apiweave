import type { GitSyncKindIconProps } from "../../types";

/**
 * One shape per sync state, so the state reads without its colour. The icon
 * and the kind it spins for come from the state's indicator, which is the one
 * place the vocabulary lives; the colour is `currentColor`, so a Button or a
 * status row decides it. `CloudAlert` is deliberately shared by `attention`
 * and `error`, as the plan's table specifies: the two are told apart by colour
 * and by the word beside them, not by a second warning shape. Decorative: the
 * label beside it says the state.
 */
export function GitSyncKindIcon({ indicator, className = "h-4 w-4" }: GitSyncKindIconProps) {
  const { icon: Icon, kind } = indicator;
  if (Icon === null) return null;
  const spin = kind === "syncing" ? "motion-safe:animate-spin" : "";
  return <Icon className={`${className} ${spin}`.trim()} aria-hidden="true" />;
}
