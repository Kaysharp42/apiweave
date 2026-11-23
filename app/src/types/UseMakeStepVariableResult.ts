import type { MakeStepVariableDialogProps } from "./MakeStepVariableDialogProps";

export interface UseMakeStepVariableResult {
  /** Whether the step menu offers **Make value a variable** for this node. */
  readonly canMake: (nodeId: string) => boolean;
  /** Open the dialog for this node. */
  readonly start: (nodeId: string) => void;
  /** The dialog, with the node it is open for (null when closed). */
  readonly dialog: MakeStepVariableDialogProps & { readonly nodeId: string | null };
}
