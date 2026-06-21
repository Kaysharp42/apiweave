import type { NodeModalNodeType } from "./NodeModalNodeType";
import type { NodeModalData } from "./NodeModalData";

export interface NodeModalNode {
  id: string;
  type: NodeModalNodeType;
  position: { x: number; y: number };
  data: NodeModalData;
}
