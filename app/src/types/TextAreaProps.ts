import type { TextareaHTMLAttributes, ChangeEventHandler } from "react";

export interface TextAreaProps
  extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "size"> {
  label?: string;
  error?: string;
  helperText?: string;
  size?: "xs" | "sm" | "md" | "lg";
  autoResize?: boolean;
  id?: string;
  value?: string;
  onChange?: ChangeEventHandler<HTMLTextAreaElement>;
}
