import type { NodeModalHTTPRequestConfig } from "./NodeModalHTTPRequestConfig";
import type { NodeModalHttpTabKey } from "./NodeModalHttpTabKey";

export interface HTTPRequestConfigPanelProps {
  initialConfig: NodeModalHTTPRequestConfig;
  workingDataRef: React.MutableRefObject<Record<string, unknown>>;
  activeTab: NodeModalHttpTabKey;
  config?: NodeModalHTTPRequestConfig;
  onConfigChange?: (config: NodeModalHTTPRequestConfig) => void;
  /**
   * The node's last execution result, used to preview what each extractor
   * would capture. Extractor paths resolve against the whole result, so this
   * is the raw result object, not just its body.
   */
  lastResult?: Record<string, unknown> | null;
}
