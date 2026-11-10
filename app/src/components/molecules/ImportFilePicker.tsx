import { CheckCircle } from "lucide-react";
import { FileDropZone } from "./FileDropZone";
import type { ImportFilePickerProps } from "../../types";

/**
 * A file import dialog's picker: the shared dashed drop zone, and the chosen
 * file's name under it once there is one. The import dialogs differ in what
 * they parse, not in how a file is picked.
 */
export function ImportFilePicker({
  title,
  hint,
  accept,
  inputAriaLabel,
  file,
  onFileSelect,
}: ImportFilePickerProps) {
  return (
    <div>
      <FileDropZone
        title={title}
        hint={hint}
        accept={accept}
        inputAriaLabel={inputAriaLabel}
        onFileSelect={onFileSelect}
      />
      {file !== null && (
        <p className="mt-3 flex items-center justify-center gap-1 text-sm text-status-success">
          <CheckCircle className="w-4 h-4" aria-hidden="true" />
          <span>{file.name}</span>
        </p>
      )}
    </div>
  );
}
