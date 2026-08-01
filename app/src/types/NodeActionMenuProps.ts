export interface NodeActionMenuProps {
  nodeId: string;
  collapsible?: boolean;
  isExpanded?: boolean;
  presetable?: boolean;
  onDuplicate?: (nodeId: string) => void;
  onCopy?: (nodeId: string) => void;
  onSaveAsPreset?: (nodeId: string) => void;
  onToggleExpand?: (nextExpanded: boolean) => void;
  triggerClassName?: string;
}
