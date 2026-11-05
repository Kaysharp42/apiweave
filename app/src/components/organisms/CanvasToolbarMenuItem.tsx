import { MenuItem } from "@headlessui/react";
import { Kbd } from "../atoms/Kbd";
import type { ToolbarMenuItemProps } from "../../types";

/** One row shared by the toolbar's menus: icon, label, optional chord hint. */
export function CanvasToolbarMenuItem({
  icon: Icon,
  label,
  shortcut,
  hint,
  title,
  onSelect,
  disabled = false,
}: ToolbarMenuItemProps) {
  return (
    <MenuItem
      as="button"
      type="button"
      onClick={onSelect}
      disabled={disabled}
      title={title}
      className={[
        "flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors duration-150 motion-reduce:transition-none",
        "text-text-primary dark:text-text-primary-dark",
        "data-focus:bg-surface-overlay dark:data-focus:bg-surface-dark-overlay",
        "focus-visible:outline-2 focus-visible:outline-(--aw-primary) focus-visible:-outline-offset-2",
        disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer",
      ].join(" ")}
    >
      <Icon className="h-3.5 w-3.5 shrink-0 text-text-muted dark:text-text-muted-dark" />
      <span className="min-w-0 flex-1">
        <span className="block truncate">{label}</span>
        {hint !== undefined && (
          <span className="block text-xs text-text-secondary dark:text-text-secondary-dark">
            {hint}
          </span>
        )}
      </span>
      {shortcut !== undefined && (
        <Kbd className="shrink-0 pl-4">{shortcut}</Kbd>
      )}
    </MenuItem>
  );
}
