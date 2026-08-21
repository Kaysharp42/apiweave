/**
 * The two "should this replace what the user is looking at?" decisions the
 * canvas makes about writes it did not initiate. Both are pure so they can be
 * tested without standing up a ReactFlow canvas, and both default to leaving
 * the user's work alone.
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
