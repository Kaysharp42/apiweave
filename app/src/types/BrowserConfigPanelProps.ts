import type { NodeModalBrowserTabKey } from "./NodeModalBrowserTabKey";

export interface BrowserConfigPanelProps {
  initialConfig: Record<string, unknown>;
  workingDataRef: React.MutableRefObject<Record<string, unknown>>;
  activeTab: NodeModalBrowserTabKey;
}
