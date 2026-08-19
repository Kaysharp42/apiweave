export interface ToolbarButtonProps {
  icon: React.ElementType;
  label: string;
  onClick: () => void;
  tooltip?: string;
  /**
   * Off collapses the button to its icon, with the label left to the tooltip.
   * Driven by how much room the toolbar was given, not by a viewport
   * breakpoint — see `resolveToolbarDensity`. Defaults to on.
   */
  showLabel?: boolean;
}
