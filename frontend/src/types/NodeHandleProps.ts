import type { CSSProperties } from "react";

export interface NodeHandleProps {
  type?: "source" | "target";
  position?: "top" | "bottom" | "left" | "right";
  id?: string;
  color?: string;
  className?: string;
  style?: CSSProperties;
}
