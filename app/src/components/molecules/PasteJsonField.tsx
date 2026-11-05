import type { ChangeEvent } from "react";
import type { PasteJsonFieldProps } from "../../types";
import { TextArea } from "../atoms/TextArea";

/** A labelled textarea for pasting bundle JSON instead of uploading a file. */
export function PasteJsonField({
  id,
  label,
  value,
  placeholder,
  onChange,
  rows,
  className = "w-full h-32",
}: PasteJsonFieldProps) {
  const handleChange = (event: ChangeEvent<HTMLTextAreaElement>): void => {
    onChange(event.target.value);
  };

  return (
    <div>
      <label
        htmlFor={id}
        className="block text-sm font-medium mb-2 text-text-primary dark:text-text-primary-dark"
      >
        {label}
      </label>
      <TextArea
        id={id}
        value={value}
        onChange={handleChange}
        placeholder={placeholder}
        rows={rows}
        className={className}
      />
    </div>
  );
}
