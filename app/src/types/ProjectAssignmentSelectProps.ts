import type { Project } from "./Project";

export interface ProjectAssignmentSelectProps {
  readonly projects: readonly Project[];
  readonly isLoading: boolean;
  /** A project's `collectionId`, or `unassignedValue` for no project. */
  readonly value: string;
  readonly onChange: (projectId: string) => void;
  readonly disabled: boolean;
  readonly ariaLabel: string;
  /** The value of the "No project" option. */
  readonly unassignedValue: string;
}
