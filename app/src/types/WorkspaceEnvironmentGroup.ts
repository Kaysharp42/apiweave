import type { ScopedEnvironment } from "./ScopedEnvironment";

/** One workspace's slice of the grouped environments list. */
export interface WorkspaceEnvironmentGroup {
  readonly workspaceId: string;
  readonly name: string;
  readonly environments: ScopedEnvironment[];
}
