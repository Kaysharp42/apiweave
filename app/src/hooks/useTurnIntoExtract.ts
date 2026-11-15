import { useCallback, useState } from "react";
import { toast } from "sonner";
import type { UseTurnIntoExtractParams } from "../types/UseTurnIntoExtractParams";
import type { UseTurnIntoExtractResult } from "../types/UseTurnIntoExtractResult";
import { canTurnIntoExtract, suggestedVariableName, turnIntoExtract } from "../utils/turnIntoExtract";

/** What a typed name becomes: only letters, digits and `_`, not starting with a digit. */
function variableNameFrom(typed: string): string {
  return typed.replace(/[^A-Za-z0-9_]/g, "").replace(/^[0-9]+/, "");
}

/**
 * **Turn into extract** on a browser step: keep the element it acts on, and
 * read it into a workflow variable instead. The recorder's toolbar has no
 * extract mode, so this is how a recorded step becomes one. The change goes
 * through `setNodes` like any edit: auto-save keeps it, undo takes it back.
 */
export function useTurnIntoExtract({ nodesRef, setNodes }: UseTurnIntoExtractParams): UseTurnIntoExtractResult {
  const [nodeId, setNodeId] = useState<string | null>(null);
  const target = nodeId === null ? undefined : nodesRef.current.find((node) => node.id === nodeId);

  const canTurn = useCallback(
    (id: string) => {
      const node = nodesRef.current.find((candidate) => candidate.id === id);
      return node !== undefined && canTurnIntoExtract(node);
    },
    [nodesRef],
  );

  const onSubmit = useCallback(
    (typed: string) => {
      const id = nodeId;
      setNodeId(null);
      const variable = variableNameFrom(typed);
      if (id === null) return;
      if (variable === "") {
        toast.error("A variable name needs at least one letter. Letters, digits and _ only.");
        return;
      }
      // A save reads the ref: set it first, so Ctrl+S right after keeps the change.
      nodesRef.current = nodesRef.current.map((node) => (node.id === id && canTurnIntoExtract(node) ? turnIntoExtract(node, variable) : node));
      setNodes(nodesRef.current);
      toast.success(`The step now saves its element into {{variables.${variable}}}`);
    },
    [nodeId, nodesRef, setNodes],
  );

  return {
    canTurn,
    start: setNodeId,
    dialog: {
      nodeId,
      open: target !== undefined,
      defaultValue: target === undefined ? "" : suggestedVariableName(target),
      onClose: () => setNodeId(null),
      onSubmit,
    },
  };
}
