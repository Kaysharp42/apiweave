export interface StatusBadgeProps {
  status:
    | "idle"
    | "running"
    | "success"
    | "error"
    | "warning"
    | "info"
    | "skipped";
  label?: string;
  size?: "xs" | "sm" | "md";
  className?: string;
}
