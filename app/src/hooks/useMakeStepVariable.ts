import { useCallback, useState } from "react";
import { toast } from "sonner";
import type { MakeStepVariableChoice } from "../types/MakeStepVariableChoice";
import type { UseMakeStepVariableParams } from "../types/UseMakeStepVariableParams";
import type { UseMakeStepVariableResult } from "../types/UseMakeStepVariableResult";
import { canMakeStepVariable, makeStepVariable, stepVariableNameError } from "../utils/makeStepVariable";

/**
 * **Make value a variable** on a browser step: move a literal the step types,
 * picks or finds its element by into a workflow variable, and put
 * `{{variables.NAME}}` in its place — in this step, or in every step holding
 * the same text. The variable and the steps change in the same tick, so the
 * canvas history records them as one undo step.
 */
export function useMakeStepVariable({ nodesRef, setNodes, variables, setVariable }: UseMakeStepVariableParams): UseMakeStepVariableResult {
  const [nodeId, setNodeId] = useState<string | null>(null);
  const node = nodeId === null ? undefined : nodesRef.current.find((candidate) => candidate.id === nodeId);

  const canMake = useCallback(
    (id: string) => {
      const candidate = nodesRef.current.find((each) => each.id === id);
      return candidate !== undefined && canMakeStepVariable(candidate);
    },
    [nodesRef],
  );

  const onSubmit = useCallback(
    (choice: MakeStepVariableChoice) => {
      const id = nodeId;
      setNodeId(null);
      if (id === null) return;
      const made = makeStepVariable(nodesRef.current, id, choice);
      if (made === null || stepVariableNameError(choice.name, made.value, variables) !== undefined) return;
      if (variables[choice.name] !== made.value) setVariable(choice.name, made.value);
      // A save reads the ref: set it first, so Ctrl+S right after keeps the change.
      nodesRef.current = made.nodes;
      setNodes(made.nodes);
      toast.success(
        made.steps > 1
          ? `${made.steps} steps now use {{variables.${choice.name}}}`
          : `The step now uses {{variables.${choice.name}}}`,
      );
    },
    [nodeId, nodesRef, setNodes, variables, setVariable],
  );

  return {
    canMake,
    start: setNodeId,
    dialog: {
      nodeId,
      open: node !== undefined,
      node,
      nodes: nodesRef.current,
      variables,
      onClose: () => setNodeId(null),
      onSubmit,
    },
  };
}
