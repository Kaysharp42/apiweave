import { useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { Upload } from "lucide-react";
import type { FileDropZoneProps } from "../../types";

const DEFAULT_HINT_CLASS =
  "text-xs text-text-secondary dark:text-text-secondary-dark";
const BASE_CLASS =
  "border border-dashed border-border dark:border-border-dark rounded-sm p-6 text-center transition-colors cursor-pointer";

/** The dashed file-picker shared by the import dialogs. */
export function FileDropZone({
  title,
  hint,
  accept,
  inputAriaLabel,
  onFileSelect,
  hintClassName = DEFAULT_HINT_CLASS,
}: FileDropZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const handleDragOver = (event: DragEvent<HTMLButtonElement>): void => {
    event.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (): void => {
    setIsDragging(false);
  };

  const handleDrop = (event: DragEvent<HTMLButtonElement>): void => {
    event.preventDefault();
    setIsDragging(false);
    const file = event.dataTransfer.files[0];
    if (file) onFileSelect(file);
  };

  const handleInputChange = (event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0];
    if (file) onFileSelect(file);
  };

  return (
    <button
      type="button"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`${BASE_CLASS} ${
        isDragging
          ? "border-(--aw-primary) bg-(--aw-primary)/5"
          : "hover:bg-surface dark:hover:bg-surface-dark"
      }`}
      onClick={() => inputRef.current?.click()}
    >
      <Upload
        size={32}
        className="mx-auto mb-2 text-text-muted dark:text-text-muted-dark"
      />
      <p className="font-medium text-text-primary dark:text-text-primary-dark">
        {title}
      </p>
      <p className={hintClassName}>{hint}</p>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        onChange={handleInputChange}
        aria-label={inputAriaLabel}
        className="hidden"
      />
    </button>
  );
}
