import type { Project } from "./Project";
import type { WorkflowVariables } from "./WorkflowVariables";

export interface WorkflowState {
  variables: WorkflowVariables;
  /**
   * The variables the canvas's extractors defined last time they were
   * registered. Kept in state, not a ref, so the reducer stays pure: the next
   * registration needs them to tell extractor variables from manual ones.
   */
  extractorVariables: WorkflowVariables;
  collections: Project[];
  isLoadingCollections: boolean;
  currentCollectionId: string | null;
}
