import type { MergeConditionType } from "./MergeConditionType";
import type { NodeModalConditionLogic } from "./NodeModalConditionLogic";
import type { NodeModalMergeStrategy } from "./NodeModalMergeStrategy";

export interface NodeModalMergeConfig {
  mergeStrategy: NodeModalMergeStrategy;
  conditions: MergeConditionType[];
  conditionLogic: NodeModalConditionLogic;
  continueOnFail?: boolean;
}
