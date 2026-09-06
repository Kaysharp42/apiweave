import { useEffect, useRef } from "react";

/**
 * Run `tick` on a period, but only while the window is actually being looked at.
 *
 * A minimised or hidden APIWeave window still runs its renderer, so a plain
 * `setInterval` keeps firing: IPC round trips, SQLite reads and cloud calls
 * paid for by nobody, for as long as the app is left open. Which is most of the
 * time — this is a desktop app people leave running all day.
 *
 * The rule this encodes: **periodic work is gated on visibility, and catches up
 * on return.** Both halves matter. Stopping the interval alone would leave the
 * view showing whatever was true when the user looked away, so becoming visible
 * ticks immediately and only then restarts the period. That also makes the
 * gating invisible: the first thing a returning user sees is fresh.
 *
 * Not gated on `window.blur`. Focus is not attention — a visible window beside
 * the editor the user is typing in should keep updating.
 *
 * The canvas itself needs no equivalent: React Flow runs with
 * `onlyRenderVisibleElements`, so a node scrolled out of the viewport is
 * unmounted and does no work at all. This is for the work one level up, which
 * lives outside the canvas and keeps running regardless.
 */
export function useVisibleInterval(tick: () => void, periodMs: number): void {
  // Held in a ref so a caller passing an inline arrow does not restart the
  // interval on every render — the alternative is making every call site
  // remember to `useCallback`, which is the kind of rule that gets forgotten.
  const tickRef = useRef(tick);
  useEffect(() => {
    tickRef.current = tick;
  }, [tick]);

  useEffect(() => {
    let timer: number | undefined;

    const stop = (): void => {
      if (timer !== undefined) window.clearInterval(timer);
      timer = undefined;
    };

    const start = (): void => {
      stop();
      tickRef.current();
      timer = window.setInterval(() => tickRef.current(), periodMs);
    };

    const onVisibilityChange = (): void => {
      if (document.visibilityState === "visible") start();
      else stop();
    };

    onVisibilityChange();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      stop();
    };
  }, [periodMs]);
}
