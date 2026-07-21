import type { SelectOption } from "./SelectOption";

export interface ButtonSelectProps {
  options?: SelectOption[];
  value?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  buttonClass?: string;
  containerClass?: string;
}
