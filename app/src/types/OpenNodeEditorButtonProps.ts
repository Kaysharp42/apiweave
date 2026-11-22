import type { ReactNode } from "react";

export interface OpenNodeEditorButtonProps {
  /** The canvas node whose editor should open. */
  nodeId: string;
  /** Usually text; a browser step's screenshot is a label too. */
  label: ReactNode;
  ariaLabel: string;
  className?: string;
}
