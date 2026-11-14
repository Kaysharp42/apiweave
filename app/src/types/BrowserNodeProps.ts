import type { BrowserNodeData } from "./BrowserNodeData";

export interface BrowserNodeProps {
  id: string;
  data: BrowserNodeData;
  selected?: boolean;
}
