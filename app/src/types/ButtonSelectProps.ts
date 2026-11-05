import type { ReactNode } from "react";
import type { SelectOption } from "./SelectOption";

export interface ButtonSelectProps {
  options?: SelectOption[];
  value?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  buttonClass?: string;
  containerClass?: string;
  /** Leading icon on the trigger, e.g. the canvas toolbar's globe. */
  icon?: ReactNode;
  /**
   * Collapse the trigger to `icon` only. The selected label stays available as
   * the accessible name and tooltip, and the list still opens in full width.
   */
  iconOnly?: boolean;
}
