import { useEffect, useState } from "react";

function matchesNow(query: string): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia(query).matches
  );
}

/**
 * Evaluate a CSS media query from JavaScript, kept in sync with the viewport.
 *
 * `MainLayout` switches between its two responsive branches with `hidden` and
 * `md:hidden`, so both of them are always in the DOM and only one is displayed.
 * That is fine for markup, and wrong for anything that may exist exactly once.
 * The agent terminal is one of those: its output arrives on a `MessagePort`, and
 * a port is delivered to a single holder, so a second copy in the hidden branch
 * takes the port and leaves the visible terminal blank. Resolving the breakpoint
 * here lets exactly one branch mount it.
 *
 * Reads `false` where `matchMedia` is missing (jsdom, and the web preview's
 * server pass) rather than throwing — the desktop branch is the right default
 * for both, and `useRunCamera` already guards the same way.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => matchesNow(query));

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }
    const list = window.matchMedia(query);
    const sync = () => setMatches(list.matches);
    // The query can have changed between the render that seeded state and this
    // effect, so read it once here rather than trusting the initial value.
    sync();
    list.addEventListener("change", sync);
    return () => list.removeEventListener("change", sync);
  }, [query]);

  return matches;
}
