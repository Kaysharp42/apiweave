import type { Workspace } from "./Workspace";

export interface CreateWorkspaceModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** When set, the workspace is created under this org; otherwise personal. */
  orgId?: string | null;
  /** Org display name, shown in the modal copy when creating an org workspace. */
  orgName?: string;
  onCreated: (workspace: Workspace) => Promise<void> | void;
}
