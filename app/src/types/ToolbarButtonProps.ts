export interface ToolbarButtonProps {
  icon: React.ElementType;
  label: string;
  onClick: () => void;
  tooltip?: string;
}
