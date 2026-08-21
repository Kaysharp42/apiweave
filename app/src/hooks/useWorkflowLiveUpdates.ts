import { useEffect, useMemo, useRef, useState } from "react";
import type { Edge, Node } from "reactflow";
import type { Workflow } from "@shared/types/Workflow";
import type { JsonValue } from "@shared/types/JsonValue";
import { canvasToWorkflow, workflowToCanvas } from "../adapters/workflowCanvas";
import { onWorkflowChanged } from "../utils/apiweaveClient";
import type { WorkflowCanvasEdgeData } from "../types/WorkflowCanvasEdgeData";
import type { WorkflowCanvasNodeData } from "../types/WorkflowCanvasNodeData";

interface UseWorkflowLiveUpdatesParams {
  workspaceId: string | null;
  workflowId: string | undefined;
  workflow: Workflow | null | undefined;
  nodes: Node<WorkflowCanvasNodeData>[];
  edges: Edge<WorkflowCanvasEdgeData>[];
  variables: Record<string, JsonValue>;
  onWorkflow: (workflow: Workflow) => void;
}

function contentSignature(workflow: Workflow): string {
  const content = { ...workflow } as Partial<Workflow>;
  delete content.rev;
  delete content.updatedAt;
  return JSON.stringify(content);
}

function normalizedContentSignature(workflow: Workflow): string {
  try {
    return contentSignature(canvasToWorkflow(workflowToCanvas(workflow), workflow));
  } catch {
    return contentSignature(workflow);
  }
}

/**
 * Reconciles writes made through MCP or another renderer into the open canvas.
 * A remote snapshot waits while local content is dirty, so it cannot erase a
 * graph the user is still editing.
 */
export default function useWorkflowLiveUpdates({
  workspaceId,
  workflowId,
  workflow,
  nodes,
  edges,
  variables,
  onWorkflow,
}: UseWorkflowLiveUpdatesParams): void {
  const [pendingVersion, setPendingVersion] = useState(0);
  const pendingWorkflowRef = useRef<Workflow | null>(null);
  const pendingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const workflowRevisionRef = useRef(workflow?.rev ?? 0);
  workflowRevisionRef.current = workflow?.rev ?? 0;

  const displayedSignature = useMemo(() => {
    if (!workflow) return null;
    try {
      return normalizedContentSignature(workflow);
    } catch {
      return null;
    }
  }, [workflow]);
  const localSignature = useMemo(() => {
    if (!workflow) return null;
    try {
      return contentSignature(
        canvasToWorkflow(
          {
            nodes,
            edges,
            variables,
            selectedEnvironmentId: workflow.selectedEnvironmentId ?? null,
          },
          workflow,
        ),
      );
    } catch {
      // A mid-edit canvas can be temporarily invalid. Do not replace it until
      // it can be compared reliably with the server snapshot.
      return null;
    }
  }, [edges, nodes, variables, workflow]);

  useEffect(() => {
    pendingWorkflowRef.current = null;
    setPendingVersion((version) => version + 1);

    if (!workspaceId || !workflowId) return;

    const unsubscribe = onWorkflowChanged((incoming) => {
      if (
        incoming.workspaceId !== workspaceId ||
        incoming.workflowId !== workflowId
      ) {
        return;
      }

      if (incoming.rev <= workflowRevisionRef.current) return;

      pendingWorkflowRef.current = incoming;
      if (pendingTimerRef.current !== null) return;
      pendingTimerRef.current = setTimeout(() => {
        pendingTimerRef.current = null;
        setPendingVersion((version) => version + 1);
      }, 50);
    });

    return () => {
      unsubscribe();
      if (pendingTimerRef.current !== null) {
        clearTimeout(pendingTimerRef.current);
        pendingTimerRef.current = null;
      }
      pendingWorkflowRef.current = null;
    };
  }, [workflowId, workspaceId]);

  useEffect(() => {
    const incoming = pendingWorkflowRef.current;
    if (!incoming || !workflow || localSignature === null) return;

    if (incoming.rev <= workflow.rev) {
      pendingWorkflowRef.current = null;
      return;
    }

    // The repository also reports writes made by this renderer. The save
    // response already updated the local graph; applying that identical
    // snapshot again would create fresh node objects and restart auto-save.
    if (localSignature === normalizedContentSignature(incoming)) {
      pendingWorkflowRef.current = null;
      return;
    }

    // Retry on later canvas changes. A clean tab applies the latest snapshot;
    // a dirty tab keeps its local graph and never loses work silently.
    if (localSignature !== displayedSignature) return;

    pendingWorkflowRef.current = null;
    onWorkflow(incoming);
  }, [
    displayedSignature,
    localSignature,
    onWorkflow,
    pendingVersion,
    workflow,
  ]);
}
