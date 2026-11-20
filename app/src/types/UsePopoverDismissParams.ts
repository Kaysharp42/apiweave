import type { RefObject } from "react";

export interface UsePopoverDismissParams {
  /** Listen only while the popover is open. */
  readonly active: boolean;
  /** The popover (and its trigger, if a press on it should not count as outside). */
  readonly rootRef: RefObject<HTMLElement | null>;
  /** A press outside `rootRef`. */
  readonly onOutsidePress: () => void;
  /**
   * Every key press while open, in the capture phase. Return true when the
   * popover handled it: the event then goes no further, so an Escape that
   * closes the popover does not also close the dialog it sits in.
   */
  readonly onKeyDown: (event: KeyboardEvent) => boolean;
}
