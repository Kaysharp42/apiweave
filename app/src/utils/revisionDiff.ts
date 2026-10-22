import type { WorkflowNode } from "@shared/types/WorkflowNode";
import type { RevisionDiff } from "../types/RevisionDiff";

/** What restoring a revision with `revision` nodes would do to a workflow with `current` nodes. */
export function revisionDiff(
  current: readonly WorkflowNode[],
  revision: readonly WorkflowNode[],
): RevisionDiff {
  const remaining = new Map(current.map((node) => [node.nodeId, JSON.stringify(node)]));
  let added = 0;
  let changed = 0;
  for (const node of revision) {
    const now = remaining.get(node.nodeId);
    if (now === undefined) added += 1;
    else if (now !== JSON.stringify(node)) changed += 1;
    remaining.delete(node.nodeId);
  }
  return { added, removed: remaining.size, changed };
}

/** Who made the write a revision was kept before, in words. */
export function revisionSourceLabel(source: string): string {
  if (source.startsWith("agent:")) return `agent ${source.slice("agent:".length)}`;
  switch (source) {
    case "canvas":
      return "canvas edits";
    case "cloud":
      return "cloud sync";
    case "git":
      return "git sync";
    case "import":
      return "import";
    case "restore":
      return "restore";
    default:
      return source;
  }
}
