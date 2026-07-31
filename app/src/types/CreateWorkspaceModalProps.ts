import type { Workspace } from "./Workspace";

export interface CreateWorkspaceModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated: (workspace: Workspace) => Promise<void> | void;
}
