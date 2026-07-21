export interface PanelProps {
  title: string;
  icon?: React.ElementType;
  collapsible?: boolean;
  defaultExpanded?: boolean;
  headerActions?: React.ReactNode;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
}
