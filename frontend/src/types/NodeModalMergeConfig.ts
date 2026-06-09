import type { MergeConditionType } from './MergeConditionType';

export interface NodeModalMergeConfig {
  mergeStrategy: string;
  conditions: MergeConditionType[];
  conditionLogic: string;
}