export interface NodeActionMenuProps {
  nodeId: string;
  collapsible?: boolean;
  isExpanded?: boolean;
  presetable?: boolean;
  /** A step a rerun can start at: offers "Run from here". */
  runnable?: boolean;
  onRunFrom?: (nodeId: string) => void;
  onDuplicate?: (nodeId: string) => void;
  onCopy?: (nodeId: string) => void;
  onSaveAsPreset?: (nodeId: string) => void;
  onToggleExpand?: (nextExpanded: boolean) => void;
  triggerClassName?: string;
}
