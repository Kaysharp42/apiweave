import type { ContextMenuItem } from "./ContextMenuItem";
import type { ContextMenuController } from "./ContextMenuController";

/** A sidebar row's right-click menu: its controller, the name it acts on, and its items. */
export interface SidebarContextMenuProps {
  readonly menu: ContextMenuController;
  /** Say what the menu acts on, e.g. `Workflow "Login"`. */
  readonly label: string;
  readonly items: readonly ContextMenuItem[];
}
