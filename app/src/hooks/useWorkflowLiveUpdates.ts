import { useEffect, useRef, useState } from "react";
import type { Edge, Node } from "reactflow";
import type { Workflow } from "@shared/types/Workflow";
import type { JsonValue } from "@shared/types/JsonValue";
import { WorkflowSchema } from "@shared/zod-schemas/WorkflowSchema";
import { canvasToWorkflow, workflowToCanvas } from "../adapters/workflowCanvas";
import { onWorkflowChanged } from "../utils/apiweaveClient";
import { toast } from "sonner";
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
  /** The open workflow was deleted, or moved out of this workspace. */
  onDetached: () => void;
}

/** How long consecutive snapshots are folded into a single application. */
const COALESCE_MS = 50;

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
 * Signature of what the canvas currently shows, comparable with a server
 * snapshot's {@link normalizedContentSignature}. Runs a full schema round-trip
 * over the graph, so callers must reach for it only when a snapshot is
 * actually waiting — never per drag frame.
 */
function localContentSignature(
  nodes: Node<WorkflowCanvasNodeData>[],
  edges: Edge<WorkflowCanvasEdgeData>[],
  variables: Record<string, JsonValue>,
  workflow: Workflow,
): string | null {
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
}

/**
 * Reconciles writes made through MCP, cloud sync, or another renderer into the
 * open canvas. A remote snapshot waits while local content is dirty, so it
 * cannot erase a graph the user is still editing.
 */
export default function useWorkflowLiveUpdates({
  workspaceId,
  workflowId,
  workflow,
  nodes,
  edges,
  variables,
  onWorkflow,
  onDetached,
}: UseWorkflowLiveUpdatesParams): void {
  const [pendingVersion, setPendingVersion] = useState(0);
  const pendingWorkflowRef = useRef<Workflow | null>(null);
  const pendingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Set when the coalescing timer fires: the snapshot may now be applied.
  const dueRef = useRef(false);
  // Set while a snapshot sits held because the canvas was dirty or not yet
  // comparable. The apply effect must then re-examine it on the next canvas
  // change — not only when the coalescing timer fires, which has already
  // spent its one shot.
  const retryOnCanvasChangeRef = useRef(false);

  // Latest-ref pattern: the callbacks arrive as fresh inline arrows on every
  // render, so naming them in the apply effect's dependencies would re-run
  // that effect — and apply any held snapshot — on every unrelated render.
  const onWorkflowRef = useRef(onWorkflow);
  const onDetachedRef = useRef(onDetached);
  useEffect(() => {
    onWorkflowRef.current = onWorkflow;
    onDetachedRef.current = onDetached;
  });

  const workflowRevisionRef = useRef(workflow?.rev ?? 0);
  workflowRevisionRef.current = workflow?.rev ?? 0;

  useEffect(() => {
    pendingWorkflowRef.current = null;
    dueRef.current = false;
    retryOnCanvasChangeRef.current = false;
    setPendingVersion((version) => version + 1);

    if (!workspaceId || !workflowId) return;

    const unsubscribe = onWorkflowChanged((event) => {
      if (event.kind === "delete") {
        if (
          event.workflowId === workflowId &&
          event.workspaceId === workspaceId
        ) {
          onDetachedRef.current();
        }
        return;
      }

      // The channel crosses process and transport boundaries; validate before
      // anything downstream trusts the shape.
      let incoming: Workflow;
      try {
        incoming = WorkflowSchema.parse(event.workflow);
      } catch (error) {
        console.error(
          "[live-updates] ignoring malformed workflow snapshot",
          error,
        );
        return;
      }

      if (incoming.workflowId !== workflowId) return;
      if (incoming.workspaceId !== workspaceId) {
        // Moved to another workspace: this canvas is scoped to the old one.
        onDetachedRef.current();
        return;
      }
      if (incoming.rev <= workflowRevisionRef.current) return;

      pendingWorkflowRef.current = incoming;
      if (pendingTimerRef.current !== null) return;
      pendingTimerRef.current = setTimeout(() => {
        pendingTimerRef.current = null;
        dueRef.current = true;
        setPendingVersion((version) => version + 1);
      }, COALESCE_MS);
    });

    return () => {
      unsubscribe();
      if (pendingTimerRef.current !== null) {
        clearTimeout(pendingTimerRef.current);
        pendingTimerRef.current = null;
      }
      pendingWorkflowRef.current = null;
      dueRef.current = false;
      retryOnCanvasChangeRef.current = false;
    };
  }, [workflowId, workspaceId]);

  useEffect(() => {
    const incoming = pendingWorkflowRef.current;
    if (!incoming || !workflow) return;

    // Only two things can change the verdict on a held snapshot: the
    // coalescing timer fired, or a previous pass deferred and the canvas has
    // moved since. Anything else — including renders driven by run progress —
    // leaves the snapshot untouched, and skips the expensive signature
    // round-trips below entirely.
    if (!dueRef.current && !retryOnCanvasChangeRef.current) return;
    dueRef.current = false;

    const displayedSignature = normalizedContentSignature(workflow);
    const localSignature = localContentSignature(
      nodes,
      edges,
      variables,
      workflow,
    );
    if (localSignature === null) {
      retryOnCanvasChangeRef.current = true;
      return;
    }

    if (incoming.rev <= workflow.rev) {
      // A local save overtook the held snapshot: the later local write won
      // server-side, and applying the older remote graph now would clobber
      // it. Dropping is correct — dropping silently is what would hide the
      // loss, so a real divergence is named.
      pendingWorkflowRef.current = null;
      retryOnCanvasChangeRef.current = false;
      const incomingSignature = normalizedContentSignature(incoming);
      // An overtaken snapshot whose content is already what the canvas took
      // from the server is this renderer's own save echoing back: the broadcast
      // is emitted inside the IPC handler, before the save response returns, so
      // it passes the revision filter and is still in the coalescing window
      // when the response arrives. Nothing remote was lost, and keeping edits
      // typed during that window is not an overwrite worth warning about.
      if (
        incomingSignature !== displayedSignature &&
        localSignature !== displayedSignature &&
        localSignature !== incomingSignature
      ) {
        console.warn("[live-updates] discarded a remote change overtaken by local edits", {
          workflowId,
          incomingRev: incoming.rev,
          localRev: workflow.rev,
        });
        toast.warning(
          "Remote changes to this workflow were overwritten by your unsaved edits",
        );
      }
      return;
    }

    // The repository also reports writes made by this renderer. The save
    // response already updated the local graph; applying that identical
    // snapshot again would create fresh node objects and restart auto-save.
    if (localSignature === normalizedContentSignature(incoming)) {
      pendingWorkflowRef.current = null;
      retryOnCanvasChangeRef.current = false;
      return;
    }

    // Retry on later canvas changes. A clean tab applies the latest snapshot;
    // a dirty tab keeps its local graph and never loses work silently.
    if (localSignature !== displayedSignature) {
      retryOnCanvasChangeRef.current = true;
      return;
    }

    retryOnCanvasChangeRef.current = false;
    pendingWorkflowRef.current = null;
    onWorkflowRef.current(incoming);
  }, [edges, nodes, pendingVersion, variables, workflow, workflowId]);
}
