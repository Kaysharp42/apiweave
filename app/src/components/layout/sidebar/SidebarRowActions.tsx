import type { SidebarRowActionsProps } from "../../../types";

/**
 * The gradient that fades a row's text out from under its action buttons while
 * the row is at rest.
 */
const IDLE_GRADIENT =
  "bg-linear-to-l from-surface-overlay from-70% to-transparent dark:from-surface-dark-overlay";

/**
 * The same fade for a selected row. The selected row is tinted with
 * `bg-primary/10` over the sidebar surface, and that tint is translucent — so a
 * grey `surface-overlay` fade paints a dull block across it instead of blending.
 * Mixing the same primary into the raised surface produces the opaque colour
 * that tint composites to, which is why this reads as a continuation of the row
 * rather than a plate on top of it.
 */
const ACTIVE_GRADIENT =
  "bg-linear-to-l from-[color-mix(in_oklab,var(--aw-primary)_10%,var(--aw-surface-raised))] from-70% to-transparent dark:from-[color-mix(in_oklab,var(--aw-primary-light)_10%,var(--aw-surface-raised))]";

/**
 * The hover/focus action strip that floats over the right end of a sidebar row.
 *
 * Pointer handling is deliberately split three ways:
 *
 * - the outer strip is always `pointer-events-none`, including its `pl-6`
 *   gradient padding, so an overlay that is about to appear never steals clicks
 *   from the row button underneath;
 * - the inner group is also `pointer-events-none` while hidden, so the buttons
 *   staying in the tab order do not become invisible click targets at opacity 0;
 * - `group-hover`/`group-focus-within` make the inner group interactive at the
 *   exact moment the row reveals it. Focus is the keyboard's hover, so Tab still
 *   reveals and reaches the actions.
 */
export function SidebarRowActions({
  children,
  active = false,
}: SidebarRowActionsProps) {
  return (
    <div
      className={[
        "pointer-events-none absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-0.5 rounded-sm pl-6",
        active ? ACTIVE_GRADIENT : IDLE_GRADIENT,
        "opacity-0 transition-opacity duration-150 motion-reduce:transition-none",
        "group-hover:opacity-100 group-focus-within:opacity-100",
      ].join(" ")}
    >
      <div className="pointer-events-none flex items-center gap-0.5 group-hover:pointer-events-auto group-focus-within:pointer-events-auto">
        {children}
      </div>
    </div>
  );
}
