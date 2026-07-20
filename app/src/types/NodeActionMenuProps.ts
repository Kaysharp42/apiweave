export interface NodeActionMenuProps {
  nodeId: string;
  collapsible?: boolean;
  isExpanded?: boolean;
  onDuplicate?: (nodeId: string) => void;
  onCopy?: (nodeId: string) => void;
  onToggleExpand?: (nextExpanded: boolean) => void;
  triggerClassName?: string;
}
