import type { ModalProps } from "./ModalProps";

export interface ModalInternalProps extends ModalProps {
  headerExtra?: React.ReactNode;
  showClose?: boolean;
  scrollable?: boolean;
  initialFocus?: React.MutableRefObject<HTMLElement | null>;
  className?: string;
}
