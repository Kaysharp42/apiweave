import { useCallback, useRef } from "react";
import { toast } from "sonner";
import { useStepMenuTarget } from "./useStepMenuTarget";
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
export function useMakeStepVariable({ nodes, nodesRef, setNodes, variables, setVariable }: UseMakeStepVariableParams): UseMakeStepVariableResult {
  const target = useStepMenuTarget(nodes, canMakeStepVariable);
  const { close, nodeId, start } = target;

  // A submit that ends this opening — it applied its change, or there was
  // nothing left to apply — ends it once. A second submit in the same tick,
  // Enter then click before the re-render, must not run the change again.
  const doneRef = useRef(false);

  const openFor = useCallback(
    (id: string) => {
      doneRef.current = false;
      start(id);
    },
    [start],
  );

  const onSubmit = useCallback(
    (choice: MakeStepVariableChoice) => {
      if (nodeId === null || doneRef.current) return;
      const made = makeStepVariable(nodesRef.current, nodeId, choice);
      if (made === null) {
        doneRef.current = true;
        close();
        toast.error("That value is no longer in the step, so nothing was replaced.");
        return;
      }
      // The name was valid when the dialog opened; the variables may have
      // changed since. The dialog stays open and shows this error itself,
      // next to the name, so the typed name is kept and can be fixed.
      const nameError = stepVariableNameError(choice.name, made.value, variables);
      if (nameError !== undefined) return;
      doneRef.current = true;
      if (variables[choice.name] !== made.value) setVariable(choice.name, made.value);
      // A save reads the ref: set it first, so Ctrl+S right after keeps the change.
      nodesRef.current = made.nodes;
      setNodes(made.nodes);
      close();
      toast.success(
        made.steps > 1
          ? `${made.steps} steps now use {{variables.${choice.name}}}`
          : `The step now uses {{variables.${choice.name}}}`,
      );
    },
    [nodeId, close, nodesRef, setNodes, variables, setVariable],
  );

  return {
    canMake: target.can,
    start: openFor,
    dialog: {
      nodeId: target.nodeId,
      open: target.node !== undefined,
      node: target.node,
      nodes,
      variables,
      onClose: target.close,
      onSubmit,
    },
  };
}
