import type { JsonValue } from "@shared/types/JsonValue";
import type { Project } from "./Project";
import type { WorkflowVariables } from "./WorkflowVariables";

export interface WorkflowContextValue {
  workflowId: string | undefined;
  /** The workflow's stored variables: what a save writes. */
  variables: WorkflowVariables;
  /**
   * Stored variables plus the names the canvas's extractors define, for
   * display and pickers only. Never save this: extractor names are derived
   * from the graph and need no stored entry.
   */
  availableVariables: WorkflowVariables;
  collections: Project[];
  isLoadingCollections: boolean;
  currentCollectionId: string | null;
  currentCollection: Project | null;
  setVariables: React.Dispatch<React.SetStateAction<WorkflowVariables>>;
  setCurrentCollectionId: React.Dispatch<React.SetStateAction<string | null>>;
  updateVariable: (varName: string, varValue: JsonValue) => void;
  deleteVariable: (varName: string) => void;
  deleteVariablesWithCleanup: (varNames: string[]) => void;
  updateVariables: (newVariables: WorkflowVariables) => void;
  registerExtractors: (extractors: WorkflowVariables) => void;
  fetchCollections: () => Promise<void>;
  refreshCollectionsAndWorkflows: () => void;
  onVariablesDeletedRef: React.MutableRefObject<
    ((varNames: string[]) => void) | null
  >;
}
