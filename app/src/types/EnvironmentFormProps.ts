import type { ScopedEnvironment } from "./ScopedEnvironment";
import type { EnvironmentFormData } from "./EnvironmentFormData";
import type { WorkspaceOption } from "./WorkspaceOption";

export interface EnvironmentFormProps {
  /** Existing environment to edit. Undefined for create mode. */
  environment?: ScopedEnvironment;
  /** Called when the form is submitted. */
  onSubmit: (data: EnvironmentFormData) => void | Promise<void>;
  /** Called when the user cancels. */
  onCancel: () => void;
  /** Whether the form is submitting. */
  submitting?: boolean;
  /** Available workspace IDs for org env allowed-workspace policy. */
  availableWorkspaces?: WorkspaceOption[];
  /** Whether to show the allowed-workspace selector (org scope only). */
  showAllowedWorkspaces?: boolean;
  className?: string;
}

export type { EnvironmentFormData };
export type { WorkspaceOption } from "./WorkspaceOption";
