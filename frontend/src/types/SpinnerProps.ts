import type { HTMLAttributes } from "react";

export interface SpinnerProps extends HTMLAttributes<HTMLOutputElement> {
  type?: "spinner" | "dots" | "ring" | "ball" | "bars" | "infinity";
  size?: "xs" | "sm" | "md" | "lg";
  color?: string;
}
