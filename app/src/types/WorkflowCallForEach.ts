export interface WorkflowCallForEach {
  items: string;
  itemVariable: string;
  indexVariable?: string;
  concurrency?: number;
  stopOnFailure?: boolean;
}
