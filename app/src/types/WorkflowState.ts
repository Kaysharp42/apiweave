import type { Project } from "./Project";
import type { WorkflowVariables } from "./WorkflowVariables";

export interface WorkflowState {
  variables: WorkflowVariables;
  /**
   * The variables the canvas's extractors define, keyed by name. Derived from
   * the graph and kept apart from `variables`, which is what a save writes.
   */
  extractorVariables: WorkflowVariables;
  collections: Project[];
  isLoadingCollections: boolean;
  currentCollectionId: string | null;
}
