import type { ApiResponse } from "./ApiResponse";
import type { NodeResultMetadata } from "./NodeResultMetadata";

export interface ResponseInspectorProps {
  response: ApiResponse | null;
  metadata?: NodeResultMetadata;
  rawBody?: string;
  filterQuery?: string;
  /** Variable name -> extractor path already configured on the node. */
  extractors?: Record<string, string>;
  /** Omit to render the tree without the save-as-variable affordances. */
  onAddExtractor?: (variableName: string, responsePath: string) => void;
  onRemoveExtractor?: (variableName: string) => void;
}
