import type { Workspace } from "./Workspace";

export interface UseAgentCreatedWorkspaceResult {
  /** The oldest workspace an agent created that has not been asked about yet; null when there is none. */
  readonly workspace: Workspace | null;
  /** Done with it: move on to the next one. */
  readonly dismiss: () => void;
}
