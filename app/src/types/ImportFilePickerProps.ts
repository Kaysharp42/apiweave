export interface ImportFilePickerProps {
  /** Headline inside the drop zone. */
  readonly title: string;
  /** Supporting line under the headline. */
  readonly hint: string;
  /** The picker's `accept` list. */
  readonly accept: string;
  /** Accessible name of the hidden file input. */
  readonly inputAriaLabel: string;
  /** The chosen file, named under the drop zone once it is there. */
  readonly file: File | null;
  readonly onFileSelect: (file: File) => void;
}
