import type { TextareaHTMLAttributes } from "react";

/**
 * A textarea that completes `{{…}}` references. Everything the autocomplete
 * owns — value, change, caret, keys — is taken over, so those props are gone
 * and the text arrives through `onValueChange`.
 */
export interface TemplateTextAreaProps extends Omit<
  TextareaHTMLAttributes<HTMLTextAreaElement>,
  "value" | "onChange" | "onSelect" | "onKeyDown" | "onBlur"
> {
  value: string;
  onValueChange: (next: string) => void;
  /** Use the node-body textarea (auto-height, no composited scroller) instead of a plain one. */
  scrollable?: boolean;
}
