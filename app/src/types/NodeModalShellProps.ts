import type { MutableRefObject, ReactNode } from "react";
import type { NodeEditorSteps } from "./NodeEditorSteps";
import type { NodeModalNodeType } from "./NodeModalNodeType";
import type { NodeModalShellTab } from "./NodeModalShellTab";

export interface NodeModalShellProps {
  /**
   * The node shown. The shell stays mounted across Previous/Next; what shows
   * one node (its name, request bar, form and result) is keyed by this.
   */
  nodeId: string;
  nodeType: NodeModalNodeType;
  nodeLabel: string;
  tabs: NodeModalShellTab[];
  activeTab: string;
  onTabChange: (tabKey: string) => void;
  onLabelChange: (newLabel: string) => void;
  onClose: () => void;
  onCancel: () => void;
  onSave: () => void;
  /** Previous/Next in the title bar. */
  steps: NodeEditorSteps;
  /** The name field, which the dialog focuses when it opens. */
  nameRef: MutableRefObject<HTMLElement | null>;
  requestBar: ReactNode;
  children: ReactNode;
  responsePane: ReactNode;
}
