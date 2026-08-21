import type { ContextMenuItem } from "./ContextMenuItem";

export interface ContextMenuProps {
  /** Viewport coordinates of the right-click that opened the menu. */
  readonly x: number;
  readonly y: number;
  /** Accessible name — say what the menu acts on, e.g. `Project "Checkout"`. */
  readonly label: string;
  readonly items: readonly ContextMenuItem[];
  readonly onClose: () => void;
}
