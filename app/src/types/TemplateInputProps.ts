import type { InputProps } from "./InputProps";

/** An {@link InputProps} input that completes `{{…}}` references. */
export interface TemplateInputProps extends Omit<
  InputProps,
  "value" | "onChange" | "onSelect" | "onKeyDown" | "onBlur"
> {
  value: string;
  onValueChange: (next: string) => void;
}
