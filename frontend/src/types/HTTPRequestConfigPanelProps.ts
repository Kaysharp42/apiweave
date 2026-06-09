import type { NodeModalHTTPRequestConfig } from './NodeModalHTTPRequestConfig';

export interface HTTPRequestConfigPanelProps {
  initialConfig: NodeModalHTTPRequestConfig;
  workingDataRef: React.MutableRefObject<Record<string, unknown>>;
}