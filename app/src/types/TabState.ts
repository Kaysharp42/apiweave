import type { WorkspaceTab } from "./WorkspaceTab";
import type { Workflow } from "./Workflow";

export interface TabState {
  tabs: WorkspaceTab[];
  activeTabIdByWorkspace: Record<string, string | null>;
  openTab: (workflow: Workflow) => void;
  setActive: (id: string) => void;
  closeTab: (id: string) => void;
  closeOthers: (id: string) => void;
  closeAll: (workspaceId?: string) => void;
  markDirty: (id: string) => void;
  markClean: (id: string) => void;
  renameTab: (id: string, name: string) => void;
  updateTabWorkflow: (workflowId: string, workflow: Workflow | null) => void;
  activateNextTab: (workspaceId: string) => void;
  activatePrevTab: (workspaceId: string) => void;
}
