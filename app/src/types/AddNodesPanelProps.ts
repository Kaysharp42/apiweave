export interface AddNodesPanelProps {
  isModalOpen?: boolean;
  showVariablesPanel?: boolean;
  onShowVariablesPanel?: (show: boolean) => void;
  /** Scopes the saved-preset section; empty string means "no workspace yet", and the section is hidden. */
  workspaceId?: string;
}
