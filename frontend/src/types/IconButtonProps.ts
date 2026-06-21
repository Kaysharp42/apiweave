import type { ButtonHTMLAttributes, ReactNode } from "react";

export interface IconButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement> {
  tooltip?: string;
  size?: "xs" | "sm" | "md" | "lg";
  variant?:
    | "ghost"
    | "primary"
    | "secondary"
    | "outline"
    | "error"
    | "warning"
    | "success"
    | "info";
  disabled?: boolean;
  children?: ReactNode;
}
