import type { HTMLAttributes } from "react";

export interface DividerProps extends HTMLAttributes<HTMLDivElement> {
  direction?: "horizontal" | "vertical";
  text?: string;
}
