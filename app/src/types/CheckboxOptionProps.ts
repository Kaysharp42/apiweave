export interface CheckboxOptionProps {
  /** Label text; it is also the checkbox's accessible name. */
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** `plain` keeps the compact option rows used inside tab panels. */
  variant?: "default" | "plain";
}
