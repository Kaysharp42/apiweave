export interface FileDropZoneProps {
  /** Headline inside the drop zone. */
  title: string;
  /** Supporting line under the headline. */
  hint: string;
  accept: string;
  /** Accessible name of the hidden file input. */
  inputAriaLabel: string;
  onFileSelect: (file: File) => void;
  hintClassName?: string;
}
