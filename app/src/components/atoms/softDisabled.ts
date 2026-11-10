import type { SyntheticEvent } from "react";

/**
 * A disabled control that explains itself — it carries a tooltip or title —
 * has to stay hoverable and focusable, or the explanation can never be read.
 * Such a control is "soft-disabled": `aria-disabled` instead of the native
 * attribute, every activation path removed, and the default action of a click
 * cancelled, which also stops a submit button submitting its form.
 */
const ACTIVATION_HANDLERS = [
  "onClick",
  "onPointerDown",
  "onPointerUp",
  "onMouseDown",
  "onMouseUp",
  "onKeyDown",
  "onKeyUp",
  "onKeyPress",
] as const;

type ActivationHandler = (typeof ACTIVATION_HANDLERS)[number];

/** `props` without the handlers that would activate the control. */
export function withoutActivationHandlers<P extends object>(
  props: P,
): Omit<P, ActivationHandler> {
  const copy: Record<string, unknown> = {};
  Object.assign(copy, props);
  for (const key of ACTIVATION_HANDLERS) delete copy[key];
  return copy as Omit<P, ActivationHandler>;
}

/** The click handler of a soft-disabled control: nothing happens, nothing submits. */
export function cancelActivation(event: SyntheticEvent): void {
  event.preventDefault();
}

/** Drops the hover treatment, so a soft-disabled control does not invite a click. */
export function withoutHoverClasses(classes: string): string {
  return classes
    .split(/\s+/)
    .filter((token) => token !== "" && !token.includes("hover:"))
    .join(" ");
}
