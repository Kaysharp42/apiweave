import type { WorkspaceTab } from "./WorkspaceTab";

export interface WorkspaceCanvasPaneProps {
  /** The tab whose workflow the pane shows; the pane is keyed on its id. */
  readonly tab: WorkspaceTab;
  readonly showVariablesPanel: boolean;
  readonly onShowVariablesPanel: (open: boolean) => void;
  readonly activePanelTab: string;
  readonly onActivePanelTabChange: (tab: string) => void;
}
