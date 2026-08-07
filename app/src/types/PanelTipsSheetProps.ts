export interface PanelTipsSheetProps {
  isOpen: boolean;
  onClose: () => void;
  /** Sheet heading — defaults to "Tips & syntax". */
  title?: string;
  children?: React.ReactNode;
}
