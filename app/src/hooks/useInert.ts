import { useEffect, type RefObject } from "react";

/**
 * Make an element and its subtree inert while `enabled` is true.
 *
 * Used when the compact companion expands its instructions over the content
 * area: the covered workspace must not be focusable, clickable or announced.
 * Sets the DOM property directly rather than a React attribute because React
 * 18 does not type the `inert` prop.
 */
export function useInert(
  ref: RefObject<HTMLElement | null>,
  enabled: boolean,
): void {
  useEffect(() => {
    const element = ref.current;
    if (element === null) return;
    if (enabled) {
      element.setAttribute("inert", "");
      element.setAttribute("aria-hidden", "true");
    } else {
      element.removeAttribute("inert");
      element.removeAttribute("aria-hidden");
    }
    return () => {
      element.removeAttribute("inert");
      element.removeAttribute("aria-hidden");
    };
  }, [ref, enabled]);
}
