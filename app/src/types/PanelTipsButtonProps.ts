export interface PanelTipsButtonProps {
  /** Whether the tips sheet is currently open. */
  isOpen: boolean;
  /** Show the unseen indicator dot (user has never opened these tips). */
  hasUnseen?: boolean;
  onClick: () => void;
  /** Accessible label / tooltip text. */
  label?: string;
  className?: string;
}
