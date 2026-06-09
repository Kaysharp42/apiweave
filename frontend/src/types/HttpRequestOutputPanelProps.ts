import type { NodeModalNode } from './NodeModalNode';
import type { NodeModalHTTPRequestConfig } from './NodeModalHTTPRequestConfig';

export interface HttpRequestOutputPanelProps {
  node: NodeModalNode;
  initialConfig: NodeModalHTTPRequestConfig;
  output: Record<string, unknown> | null;
}