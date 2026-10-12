/**
 * The "should this replace what the user is looking at?" decisions the canvas
 * makes about writes that did not come from its own save. All are pure so they
 * can be tested without standing up a ReactFlow canvas, and all default to
 * leaving the user's work alone.
 */

import type { DetachDecisionInput } from "../types/DetachDecisionInput";
import type { BackgroundRefreshInput } from "../types/BackgroundRefreshInput";

/**
 * Whether a detach notification should close the open tab and tell the user.
 *
 * A locally issued delete or move is broadcast like any other write and races
 * the response the initiating code is still awaiting: the sidebar delete has
 * already closed the tab and toasted, and a local move deliberately relocates
 * the tab rather than closing it. One logical detach can also arrive more than
 * once — a workspace move notifies from `setWorkspace` and from the `update`
 * behind it — so a tab that is already gone means this has been handled.
 */
export function shouldActOnDetach({
  initiatedLocally,
  tabIsOpen,
}: DetachDecisionInput): boolean {
  if (initiatedLocally) return false;
  return tabIsOpen;
}

/**
 * Whether a background refresh may put its server read on the canvas.
 *
 * The fetch is asynchronous, so anything can happen while it is in flight.
 * Applying it over an edit would discard that edit, and the `markClean` that
 * comes with it would take the dirty flag too — the only signal the edit was
 * never saved. A bumped hydration version means a live snapshot already landed,
 * which makes this read the older of the two.
 */
export function canApplyBackgroundRefresh({
  hydrationVersionAtRequest,
  hydrationVersionNow,
  tabIsDirty,
}: BackgroundRefreshInput): boolean {
  if (tabIsDirty) return false;
  return hydrationVersionNow === hydrationVersionAtRequest;
}

/**
 * Whether a write this renderer made outside the canvas save (Import to nodes
 * saving templates) may become the revision the canvas's next save asserts.
 *
 * Only when it is the very next revision after the canvas's base: then nothing
 * else landed in between, and the conflict check would otherwise blame "an
 * agent or another device" for the user's own write. Any gap is a write from
 * somewhere else, which the next save must still report as a conflict.
 */
export function writeFollowsBaseRevision(
  baseRevision: number,
  writtenRevision: number,
): boolean {
  return writtenRevision === baseRevision + 1;
}
