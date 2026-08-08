import type { NodeModalNode } from "./NodeModalNode";
import type { NodeModalHTTPRequestConfig } from "./NodeModalHTTPRequestConfig";

export interface HttpRequestOutputPanelProps {
  node: NodeModalNode;
  initialConfig: NodeModalHTTPRequestConfig;
  output: Record<string, unknown> | null;
  /** Variable name -> extractor path already configured on the node. */
  extractors?: Record<string, string>;
  onAddExtractor?: (variableName: string, responsePath: string) => void;
  onRemoveExtractor?: (variableName: string) => void;
}
