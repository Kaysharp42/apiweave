import type { GrpcNodeData } from "./GrpcNodeData";

export interface GrpcNodeProps {
  id: string;
  data: GrpcNodeData;
  selected?: boolean;
}
