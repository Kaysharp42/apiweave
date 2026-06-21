import type { WorkspaceTab } from "./WorkspaceTab";
import type { Workflow } from "./Workflow";

export interface TabState {
  tabs: WorkspaceTab[];
  activeTabId: string | null;
  openTab: (workflow: Workflow) => void;
  setActive: (id: string) => void;
  closeTab: (id: string) => void;
  closeOthers: (id: string) => void;
  closeAll: () => void;
  markDirty: (id: string) => void;
  markClean: (id: string) => void;
  renameTab: (id: string, name: string) => void;
  updateTabWorkflow: (workflowId: string, workflow: Workflow | null) => void;
  activateNextTab: () => void;
  activatePrevTab: () => void;
}
