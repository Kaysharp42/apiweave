import type { MutableRefObject, ReactNode } from "react";
import type { NodeModalNodeType } from "./NodeModalNodeType";
import type { NodeModalShellTab } from "./NodeModalShellTab";

export interface NodeModalShellProps {
  open: boolean;
  nodeType: NodeModalNodeType;
  nodeLabel: string;
  tabs: NodeModalShellTab[];
  activeTab: string;
  onTabChange: (tabKey: string) => void;
  onLabelChange: (newLabel: string) => void;
  onClose: () => void;
  onCancel: () => void;
  onSave: () => void;
  initialFocus?: MutableRefObject<HTMLElement | null>;
  requestBar: ReactNode;
  children: ReactNode;
  responsePane: ReactNode;
}
