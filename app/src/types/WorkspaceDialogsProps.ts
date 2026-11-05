export interface WorkspaceDialogsProps {
  readonly showNewWorkflowPrompt: boolean;
  readonly onCloseNewWorkflowPrompt: () => void;
  readonly onCreateWorkflow: (name: string) => Promise<void>;
  readonly showOpenFromGit: boolean;
  readonly onCloseOpenFromGit: () => void;
}
