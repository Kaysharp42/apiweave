import type { NodeModalHTTPRequestConfig } from "./NodeModalHTTPRequestConfig";
import type { NodeModalHttpTabKey } from "./NodeModalHttpTabKey";

export interface HTTPRequestConfigPanelProps {
  initialConfig: NodeModalHTTPRequestConfig;
  workingDataRef: React.MutableRefObject<Record<string, unknown>>;
  activeTab: NodeModalHttpTabKey;
  config?: NodeModalHTTPRequestConfig;
  onConfigChange?: (config: NodeModalHTTPRequestConfig) => void;
}
