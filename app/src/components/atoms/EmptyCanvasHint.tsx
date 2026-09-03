/**
 * What to do with an empty canvas. Two details matter more than the copy:
 *
 * - `pointer-events-none`, so it can never eat a right-click or a box-select.
 *   A hint that swallows canvas gestures arrives as a bug report about a dead
 *   canvas, which is worse than showing no hint at all.
 * - It is rendered off the live node count rather than a persisted "seen" flag,
 *   so it comes back on any workflow someone empties instead of only on the
 *   very first run.
 */
export function EmptyCanvasHint() {
  return (
    <div className="pointer-events-none absolute inset-0 z-10 flex select-none items-center justify-center">
      <div className="max-w-sm px-6 text-center">
        <p className="text-sm font-medium text-text-secondary dark:text-text-secondary-dark">
          Nothing here yet
        </p>
        <p className="mt-1.5 text-xs leading-relaxed text-text-muted dark:text-text-muted-dark">
          Drag a node in from{" "}
          <span className="font-medium text-text-secondary dark:text-text-secondary-dark">
            Add nodes
          </span>
          , or bring a whole collection across with{" "}
          <span className="font-medium text-text-secondary dark:text-text-secondary-dark">
            Import
          </span>
          .
        </p>
      </div>
    </div>
  );
}

export default EmptyCanvasHint;
