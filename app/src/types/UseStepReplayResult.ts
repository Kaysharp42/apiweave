export interface UseStepReplayResult {
  /** Whether the step menu offers **Re-pick element** for this node. */
  readonly canRepick: (nodeId: string) => boolean;
  /** Whether the step menu offers **Re-record from here** for this node. */
  readonly canRerecord: (nodeId: string) => boolean;
  /** Replay up to the step, let the user pick its element, and put the new locator on it. */
  readonly repick: (nodeId: string) => void;
  /** Replay up to the step, then record: the new steps replace it and the browser steps after it. */
  readonly rerecord: (nodeId: string) => void;
}
