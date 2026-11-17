export interface UseTurnIntoExtractResult {
  /** Whether the step menu offers **Turn into extract** for this node. */
  readonly canTurn: (nodeId: string) => boolean;
  /** Ask for the variable name, then turn the node into an extract. */
  readonly start: (nodeId: string) => void;
  /** The variable-name prompt. */
  readonly dialog: {
    readonly nodeId: string | null;
    readonly open: boolean;
    readonly defaultValue: string;
    readonly onClose: () => void;
    readonly onSubmit: (name: string) => void;
  };
}
