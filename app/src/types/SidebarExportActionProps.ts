/** The export button a sidebar row shows on hover: the same action in both row types. */
export interface SidebarExportActionProps {
  /** Names what is exported, e.g. "Export workflow". */
  readonly label: string;
  readonly onExport: () => void;
}
