import type React from "react";
import type { ContextMenuOrigin } from "./ContextMenuOrigin";

/** What {@link useContextMenu} hands a row: where the menu is, and how to open/close it. */
export interface ContextMenuController {
  /** Null while closed — render the menu only when this is set. */
  readonly origin: ContextMenuOrigin | null;
  /** True while this row's menu is open, so the row can stay highlighted. */
  readonly isOpen: boolean;
  /**
   * Attach to `onContextMenu`; suppresses the native menu. A keyboard open
   * (Shift+F10 / the ContextMenu key) passes the focused row's rectangle
   * instead.
   */
  readonly openAt: (anchor: React.MouseEvent | ContextMenuOrigin) => void;
  readonly close: () => void;
}
