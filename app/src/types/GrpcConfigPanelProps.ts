import type { NodeModalGrpcConfig } from "./NodeModalGrpcConfig";
import type { NodeModalGrpcTabKey } from "./NodeModalGrpcTabKey";

export interface GrpcConfigPanelProps {
  initialConfig: Partial<NodeModalGrpcConfig>;
  workingDataRef: React.MutableRefObject<Record<string, unknown>>;
  activeTab: NodeModalGrpcTabKey;
}
