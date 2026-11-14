import type { LoadRunRequest } from "./LoadRunRequest";

export interface LoadRunDialogProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  /** Called with valid settings; the dialog closes itself. */
  readonly onStart: (request: LoadRunRequest) => void;
}
