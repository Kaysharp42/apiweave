import type { Node } from "reactflow";
import type { WorkflowCanvasNodeData } from "../types/WorkflowCanvasNodeData";
import type {
  VariableProvenance,
} from "../types/VariableProvenance";
import type { VariableProvenanceMap } from "../types/VariableProvenanceMap";
import type { ProvenanceProducer } from "../types/ProvenanceProducer";
import type { ProvenanceConsumer } from "../types/ProvenanceConsumer";

const VARIABLE_REF_RE = /\{\{\s*variables\.([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;

function nodeLabel(node: Node<WorkflowCanvasNodeData>): string {
  const label = node.data?.label;
  return typeof label === "string" && label.trim() ? label : node.id;
}

/** Recursively visit every string value under `config`, tagged with its root key. */
function forEachConfigString(
  config: Record<string, unknown> | undefined,
  cb: (rootKey: string, value: string) => void,
): void {
  if (!config) return;
  const visit = (rootKey: string, value: unknown): void => {
    if (typeof value === "string") {
      cb(rootKey, value);
    } else if (Array.isArray(value)) {
      for (const item of value) visit(rootKey, item);
    } else if (value !== null && typeof value === "object") {
      for (const v of Object.values(value as Record<string, unknown>)) visit(rootKey, v);
    }
  };
  for (const [key, value] of Object.entries(config)) visit(key, value);
}

/**
 * Build a provenance map over the canvas nodes: for each variable, the node +
 * extractor path that produced it (producers) and the nodes + fields that
 * reference it via {{variables.NAME}} (consumers). Read-only over the graph.
 */
export function computeProvenance(
  nodes: readonly Node<WorkflowCanvasNodeData>[],
): VariableProvenanceMap {
  const map: Record<string, VariableProvenance> = {};
  const ensure = (name: string): VariableProvenance => {
    const existing = map[name];
    if (existing) return existing;
    const fresh: VariableProvenance = { producers: [], consumers: [] };
    map[name] = fresh;
    return fresh;
  };

  for (const node of nodes) {
    const config = node.data?.config;
    if (!config) continue;

    // Producers: extractor entries (varName → response path).
    const extractors = config["extractors"];
    if (extractors !== null && typeof extractors === "object" && !Array.isArray(extractors)) {
      for (const [varName, rawPath] of Object.entries(extractors as Record<string, unknown>)) {
        if (typeof rawPath !== "string") continue;
        const producer: ProvenanceProducer = {
          nodeId: node.id,
          nodeLabel: nodeLabel(node),
          path: rawPath,
        };
        const entry = ensure(varName);
        map[varName] = {
          producers: [...entry.producers, producer],
          consumers: entry.consumers,
        };
      }
    }

    // Consumers: {{variables.NAME}} refs in any config string.
    const refs = new Map<string, Set<string>>();
    forEachConfigString(config, (rootKey, value) => {
      VARIABLE_REF_RE.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = VARIABLE_REF_RE.exec(value)) !== null) {
        const name = match[1]!;
        let fields = refs.get(name);
        if (!fields) {
          fields = new Set<string>();
          refs.set(name, fields);
        }
        fields.add(rootKey);
      }
    });
    for (const [varName, fields] of refs) {
      const consumer: ProvenanceConsumer = {
        nodeId: node.id,
        nodeLabel: nodeLabel(node),
        fields: [...fields],
      };
      const entry = ensure(varName);
      map[varName] = {
        producers: entry.producers,
        consumers: [...entry.consumers, consumer],
      };
    }
  }

  return map;
}
