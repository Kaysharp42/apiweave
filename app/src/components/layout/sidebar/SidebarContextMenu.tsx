import { ContextMenu } from "../../molecules/ContextMenu";
import type { SidebarContextMenuProps } from "../../../types";

/**
 * A sidebar row's right-click menu, rendered only while the row's controller
 * has somewhere to anchor it — the pointer, or the focused row for a keyboard
 * open.
 */
export function SidebarContextMenu({
  menu,
  label,
  items,
}: SidebarContextMenuProps) {
  if (menu.origin === null) return null;
  return (
    <ContextMenu
      x={menu.origin.x}
      y={menu.origin.y}
      label={label}
      items={items}
      onClose={menu.close}
    />
  );
}
