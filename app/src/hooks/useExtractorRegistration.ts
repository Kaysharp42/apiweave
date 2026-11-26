import { useEffect, useMemo, useRef } from "react";
import type { Node } from "@xyflow/react";
import type { WorkflowCanvasNodeData } from "../types/WorkflowCanvasNodeData";
import type { WorkflowVariables } from "../types/WorkflowVariables";

const EXTRACTOR_NODE_TYPES = new Set(["http-request", "sse", "grpc"]);

// Stable numeric id per `extractors` object, so a drag frame (new node object,
// same config) does not re-collect the extractors.
const extractorConfigIdMap = new WeakMap<object, number>();
let nextExtractorConfigId = 0;

/**
 * Tells the workflow context which variable names the graph's extractors
 * define. Those names are derived state: they are shown and offered, never
 * written into the stored variables.
 */
export default function useExtractorRegistration(
  nodes: readonly Node<WorkflowCanvasNodeData>[],
  registerExtractors: (extractors: WorkflowVariables) => void,
): void {
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;

  const extractorsSig = useMemo(() => {
    const parts: string[] = [];
    for (const node of nodes) {
      const extractors = node.data?.config?.extractors;
      if (!EXTRACTOR_NODE_TYPES.has(node.type ?? "") || !extractors) continue;
      let id = extractorConfigIdMap.get(extractors);
      if (id === undefined) {
        id = nextExtractorConfigId++;
        extractorConfigIdMap.set(extractors, id);
      }
      parts.push(`${node.id}:${id}`);
    }
    return parts.join("|");
  }, [nodes]);

  useEffect(() => {
    const extractorsFromNodes: Record<string, string> = {};
    for (const node of nodesRef.current) {
      const extractors = node.data?.config?.extractors;
      if (!EXTRACTOR_NODE_TYPES.has(node.type ?? "") || !extractors) continue;
      for (const [name, value] of Object.entries(extractors)) {
        if (typeof value === "string") extractorsFromNodes[name] = value;
      }
    }
    registerExtractors(extractorsFromNodes);
  }, [extractorsSig, registerExtractors]);
}
