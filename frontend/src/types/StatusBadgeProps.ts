export interface StatusBadgeProps {
  status: "idle" | "running" | "success" | "error" | "warning" | "info";
  label?: string;
  size?: "xs" | "sm" | "md";
  className?: string;
}
