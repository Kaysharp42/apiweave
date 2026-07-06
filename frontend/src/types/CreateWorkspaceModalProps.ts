import type { Workspace } from "./Workspace";

export interface CreateWorkspaceModalProps {
  isOpen: boolean;
  onClose: () => void;
  orgId?: null;
  orgName?: string;
  onCreated: (workspace: Workspace) => Promise<void> | void;
}
