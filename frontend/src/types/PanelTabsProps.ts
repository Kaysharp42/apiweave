import type { TabItem } from './TabItem';

export interface PanelTabsProps {
  tabs: TabItem[];
  activeTab: string;
  onTabChange: (key: string) => void;
}
