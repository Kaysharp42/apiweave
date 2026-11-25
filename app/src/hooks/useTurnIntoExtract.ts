import { useCallback } from "react";
import { toast } from "sonner";
import { useStepMenuTarget } from "./useStepMenuTarget";
import type { UseTurnIntoExtractParams } from "../types/UseTurnIntoExtractParams";
import type { UseTurnIntoExtractResult } from "../types/UseTurnIntoExtractResult";
import { canTurnIntoExtract, suggestedVariableName, turnIntoExtract } from "../utils/turnIntoExtract";

/** What a typed name becomes: only letters A-Z, digits and `_`, not starting with a digit. */
function variableNameFrom(typed: string): string {
  return typed.replace(/[^A-Za-z0-9_]/g, "").replace(/^[0-9]+/, "");
}

/**
 * **Turn into extract** on a browser step: keep the element it acts on, and
 * read it into a workflow variable instead. The recorder's toolbar has no
 * extract mode, so this is how a recorded step becomes one. The change goes
 * through `setNodes` like any edit: auto-save keeps it, undo takes it back.
 */
export function useTurnIntoExtract({ nodes, nodesRef, setNodes }: UseTurnIntoExtractParams): UseTurnIntoExtractResult {
  const target = useStepMenuTarget(nodes, canTurnIntoExtract);
  const { take } = target;

  const onSubmit = useCallback(
    (typed: string) => {
      const id = take();
      const variable = variableNameFrom(typed);
      if (id === null) return;
      // `_1` survives cleaning but is not a name: it needs a letter A-Z.
      if (!/[A-Za-z]/.test(variable)) {
        toast.error("A variable name needs at least one letter A–Z. Unaccented letters, digits and _ only.");
        return;
      }
      // A save reads the ref: set it first, so Ctrl+S right after keeps the change.
      nodesRef.current = nodesRef.current.map((node) => (node.id === id && canTurnIntoExtract(node) ? turnIntoExtract(node, variable) : node));
      setNodes(nodesRef.current);
      toast.success(`The step now saves its element into {{variables.${variable}}}`);
    },
    [take, nodesRef, setNodes],
  );

  return {
    canTurn: target.can,
    start: target.start,
    dialog: {
      nodeId: target.nodeId,
      open: target.node !== undefined,
      defaultValue: target.node === undefined ? "" : suggestedVariableName(target.node),
      onClose: target.close,
      onSubmit,
    },
  };
}
