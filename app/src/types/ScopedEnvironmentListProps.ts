import type {
  ScopedEnvironment,
  EnvironmentScopeType,
} from "./ScopedEnvironment";

export interface ScopedEnvironmentListProps {
  /** Environments to display, already filtered by scope. */
  environments: ScopedEnvironment[];
  /** The scope type for this section. */
  scopeType: EnvironmentScopeType;
  /** Section title override. */
  title?: string;
  /** Called when the user selects an environment. */
  onSelect: (env: ScopedEnvironment) => void;
  /** Called when the user wants to create a new environment. */
  onCreate?: () => void;
  /** Called when the user wants to edit an environment. */
  onEdit: (env: ScopedEnvironment) => void;
  /** Called when the user wants to delete an environment. */
  onDelete: (env: ScopedEnvironment) => void;
  /** Called when the user wants to duplicate an environment. */
  onDuplicate?: (env: ScopedEnvironment) => void;
  /** Called when the user wants to move an environment to another workspace. */
  onMove?: (env: ScopedEnvironment) => void;
  /**
   * Hides Edit and Delete. Set for a workspace other than the active one: those
   * environments are listed so the user can see where they live and copy or move
   * them, not so they can be edited from outside the workspace that owns them.
   */
  readOnly?: boolean;
  /** The currently selected environment ID. */
  selectedId?: string | undefined;
  className?: string;
}
