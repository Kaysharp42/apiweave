/**
 * The node layer's form-control class strings, in one place.
 *
 * Every config control inside a node — the assertion form's selects, the HTTP
 * node's textareas, the merge strategy picker — wears the same corner radius,
 * the same focus ring, and the same `nodrag` guard that stops a drag on the
 * control from panning the canvas. N3 swept those strings across seven node
 * files by hand, which left the same 20-token class list repeated a dozen
 * times: a restyle now means finding every copy.
 *
 * These are plain strings rather than a component so a control can still take
 * whatever props it needs (`rows`, `type`, `multiple`) without the wrapper
 * having to forward them.
 */

/** Label above a control. Pair with `NODE_HINT_CLASS` for the parenthetical. */
export const NODE_LABEL_CLASS =
  "block text-xs font-semibold mb-0.5 text-text-secondary dark:text-text-secondary-dark";

/** The `(key=value)` aside inside a label. */
export const NODE_HINT_CLASS = "font-normal text-[var(--aw-node-text-muted)]";

/** Validation message under a control. */
export const NODE_ERROR_CLASS = "text-xs mt-1 text-[var(--aw-status-error)]";

/**
 * Shared by every control; the per-control classes below extend it. Width is
 * deliberately absent — callers set it, and two Tailwind width utilities in one
 * class string do not resolve by source order.
 */
const NODE_CONTROL_BASE =
  "nodrag border rounded-node-ctl text-xs focus-visible:outline-2 focus-visible:outline-offset-[var(--aw-focus-ring-offset)]";

/** Resting colours: neutral border, raised surface, accent focus ring. */
const NODE_CONTROL_RESTING =
  "border-border dark:border-border-dark bg-surface-raised dark:bg-surface-dark-raised text-text-primary dark:text-text-primary-dark focus-visible:outline-[var(--aw-primary)]";

/** Invalid colours: the error hue carries border, text, tint and focus ring. */
const NODE_CONTROL_INVALID =
  "border-[var(--aw-status-error)] text-[var(--aw-status-error)] bg-[var(--aw-status-error)]/5 focus-visible:outline-[var(--aw-status-error)]";

export const NODE_SELECT_CLASS = `${NODE_CONTROL_BASE} w-full px-1.5 py-0.5 ${NODE_CONTROL_RESTING} cursor-pointer`;

export const NODE_TEXTAREA_CLASS = `${NODE_CONTROL_BASE} w-full px-1.5 py-1 font-mono ${NODE_CONTROL_RESTING}`;

/**
 * A text input, coloured by validity. `mono` is for values the user reads as
 * data — expected values, paths — rather than prose.
 */
export function nodeInputClass(
  options: { invalid?: boolean; mono?: boolean; width?: string } = {},
): string {
  return [
    NODE_CONTROL_BASE,
    options.width ?? "w-full",
    "px-1.5 py-0.5",
    options.mono ? "font-mono" : "",
    options.invalid ? NODE_CONTROL_INVALID : NODE_CONTROL_RESTING,
  ]
    .filter(Boolean)
    .join(" ");
}
