import type { NodeModalShellTab } from "./NodeModalShellTab";

export interface NodeModalVerticalTabsProps {
  tabs: NodeModalShellTab[];
  activeTab: string;
  onTabChange: (tabKey: string) => void;
}
