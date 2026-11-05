/** The state of a dialog that has no state beyond whether it is showing. */
export interface DisclosureState {
  isOpen: boolean;
  open: () => void;
  close: () => void;
}
