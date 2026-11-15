import type { CanvasToolbarRecordProps } from "./CanvasToolbarRecordProps";

export interface UseBrowserRecordingResult {
  readonly control: Omit<CanvasToolbarRecordProps, "showLabel">;
  /** The start-address dialog the Record button opens. */
  readonly dialog: {
    readonly open: boolean;
    readonly defaultUrl: string;
    readonly onClose: () => void;
    readonly onStart: (startUrl: string) => void;
  };
}
