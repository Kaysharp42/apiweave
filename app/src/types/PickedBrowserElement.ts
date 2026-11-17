import type { BrowserLocator } from "@shared/types/BrowserLocator";

/**
 * The element a re-pick picked, held in the store until the canvas of its
 * workflow puts it on the step. It names the workflow because the canvas that
 * was open when the user picked may have been closed since: only the canvas of
 * that workflow applies it, and one reopened later does.
 */
export interface PickedBrowserElement {
  readonly workflowId: string;
  readonly nodeId: string;
  readonly locator: BrowserLocator;
}
