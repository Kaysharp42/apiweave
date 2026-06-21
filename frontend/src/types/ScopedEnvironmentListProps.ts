import type { ScopedEnvironment, EnvironmentScopeType } from './ScopedEnvironment';

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
  onDuplicate?: (envId: string) => void;
  /** The currently selected environment ID. */
  selectedId?: string | undefined;
  className?: string;
}
