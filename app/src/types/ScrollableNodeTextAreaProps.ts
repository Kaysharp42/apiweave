import type { TextareaHTMLAttributes } from "react";

export interface ScrollableNodeTextAreaProps
  extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  value: string;
}
