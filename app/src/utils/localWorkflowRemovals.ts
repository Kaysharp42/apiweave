/**
 * Deletes and workspace moves the user runs from this renderer come back over
 * the `workflow-changed` channel like any other write, and the receiving canvas
 * cannot tell them apart from an agent's: the broadcast is emitted after commit
 * in the main process, so it races the response the initiating code is still
 * awaiting. Acting on one is wrong twice over — the delete path has already
 * closed the tab and toasted, and the move path deliberately *relocates* the
 * open tab rather than closing it.
 *
 * The initiator marks the workflow here before issuing the request; the detach
 * handler treats a marked id as its own doing. Marks expire so a request that
 * never lands cannot silence a genuine remote detach for the rest of the
 * session, and are not consumed on read: one logical detach can arrive as
 * several notifications.
 */
const MARK_TTL_MS = 10_000;

const marks = new Map<string, number>();

/** Record that this renderer is about to delete or move `workflowId`. */
export function noteLocalWorkflowRemoval(workflowId: string): void {
  marks.set(workflowId, Date.now() + MARK_TTL_MS);
}

/** Whether a detach notification for `workflowId` is this renderer's own doing. */
export function isLocalWorkflowRemoval(workflowId: string): boolean {
  const expiresAt = marks.get(workflowId);
  if (expiresAt === undefined) return false;
  if (expiresAt <= Date.now()) {
    marks.delete(workflowId);
    return false;
  }
  return true;
}

/** Test seam: marks outlive a single component, so suites must reset them. */
export function clearLocalWorkflowRemovals(): void {
  marks.clear();
}
