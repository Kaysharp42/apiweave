import { Download } from "lucide-react";
import { SidebarAction } from "./SidebarAction";
import type { SidebarExportActionProps } from "../../../types";

/**
 * The export button a row reveals on hover or focus. Both row types offer the
 * same action on the same icon, and neither may let the click reach the row's
 * own activate handler underneath.
 */
export function SidebarExportAction({
  label,
  onExport,
}: SidebarExportActionProps) {
  return (
    <SidebarAction
      icon={Download}
      label={label}
      onClick={(event) => {
        event.stopPropagation();
        onExport();
      }}
    />
  );
}
