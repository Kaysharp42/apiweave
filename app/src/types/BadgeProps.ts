import type { HTMLAttributes, ReactNode } from "react";

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?:
    | "default"
    | "primary"
    | "secondary"
    | "success"
    | "error"
    | "warning"
    | "info"
    | "ghost"
    | "outline";
  size?: "xs" | "sm" | "md" | "lg";
  children?: ReactNode;
}
