import type React from "react";
import type { ContextMenuOrigin } from "./ContextMenuOrigin";

/** What {@link useContextMenu} hands a row: where the menu is, and how to open/close it. */
export interface ContextMenuController {
  /** Null while closed — render the menu only when this is set. */
  readonly origin: ContextMenuOrigin | null;
  /** Attach to `onContextMenu`; suppresses the native menu. */
  readonly openAt: (event: React.MouseEvent) => void;
  readonly close: () => void;
}
