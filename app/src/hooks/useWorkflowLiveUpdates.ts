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

/** Only two events let the apply pass re-examine a snapshot it once deferred. */
function applyPassIsDue(
  coalesceTimerFired: boolean,
  deferredForCanvasChange: boolean,
): boolean {
  return coalesceTimerFired || deferredForCanvasChange;
}

/**
 * What the apply pass should do with a held server snapshot, decided purely
 * from revisions and content signatures so the decision table can be tested
 * without standing up the hook.
 */
type HeldSnapshotVerdict =
  | { readonly action: "hold" }
  | { readonly action: "drop"; readonly warnRemoteLoss: boolean }
  | { readonly action: "apply" };

const HELD_FOR_COMPARABLE_CANVAS: HeldSnapshotVerdict = { action: "hold" };
const HELD_BEHIND_UNSAVED_EDITS: HeldSnapshotVerdict = { action: "hold" };
const DROPPED_AS_OWN_ECHO: HeldSnapshotVerdict = {
  action: "drop",
  warnRemoteLoss: false,
};
const APPLIED_TO_CANVAS: HeldSnapshotVerdict = { action: "apply" };

interface HeldSnapshotFacts {
  /** Revision of the held server snapshot. */
  readonly incomingRev: number;
  /** Revision currently on the canvas. */
  readonly currentRev: number;
  readonly incomingSignature: string;
  readonly displayedSignature: string;
  /** null while the mid-edit canvas cannot be compared reliably. */
  readonly localSignature: string | null;
}

/**
 * Whether dropping an overtaken snapshot would lose real remote work. No
 * warning is due when the incoming graph is already what the canvas took from
 * the server, or when it equals the local graph — that second case is this
 * renderer's own save echoing back: the broadcast is emitted inside the IPC
 * handler, before the save response returns, so it passes the revision filter
 * and is still in the coalescing window when the response arrives. Nothing
 * remote was lost, and keeping edits typed during that window is not an
 * overwrite worth warning about.
 */
function remoteChangeWasLost(
  incomingSignature: string,
  displayedSignature: string,
  localSignature: string,
): boolean {
  return (
    incomingSignature !== displayedSignature &&
    localSignature !== displayedSignature &&
    localSignature !== incomingSignature
  );
}

function classifyFreshSnapshot(facts: HeldSnapshotFacts): HeldSnapshotVerdict {
  // The repository also reports writes made by this renderer. The save
  // response already updated the local graph; applying that identical
  // snapshot again would create fresh node objects and restart auto-save.
  if (facts.localSignature === facts.incomingSignature)
    return DROPPED_AS_OWN_ECHO;
  // Retry on later canvas changes. A clean tab applies the latest snapshot;
  // a dirty tab keeps its local graph and never loses work silently.
  if (facts.localSignature !== facts.displayedSignature)
    return HELD_BEHIND_UNSAVED_EDITS;
  return APPLIED_TO_CANVAS;
}

function classifyHeldSnapshot(facts: HeldSnapshotFacts): HeldSnapshotVerdict {
  if (facts.localSignature === null) return HELD_FOR_COMPARABLE_CANVAS;

  if (facts.incomingRev <= facts.currentRev) {
    // A local save overtook the held snapshot: the later local write won
    // server-side, and applying the older remote graph now would clobber
    // it. Dropping is correct — dropping silently is what would hide the
    // loss, so a real divergence is named.
    return {
      action: "drop",
      warnRemoteLoss: remoteChangeWasLost(
        facts.incomingSignature,
        facts.displayedSignature,
        facts.localSignature,
      ),
    };
  }

  return classifyFreshSnapshot(facts);
}

/** Side effects the apply pass may perform on the hook's state. */
interface HeldSnapshotActions {
  /** Re-examine the held snapshot on the next canvas change. */
  retryOnNextCanvasChange(): void;
  /** The snapshot is resolved either way; stop holding it. */
  forgetHeldSnapshot(): void;
  /** Name a real divergence instead of dropping silently. */
  warnOfLostRemoteChange(): void;
  /** Put the held snapshot on the canvas. */
  applyToCanvas(): void;
}

function actOnHeldSnapshot(
  verdict: HeldSnapshotVerdict,
  actions: HeldSnapshotActions,
): void {
  if (verdict.action === "hold") {
    actions.retryOnNextCanvasChange();
    return;
  }

  actions.forgetHeldSnapshot();

  if (verdict.action === "drop") {
    if (verdict.warnRemoteLoss) actions.warnOfLostRemoteChange();
    return;
  }

  actions.applyToCanvas();
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
    if (!applyPassIsDue(dueRef.current, retryOnCanvasChangeRef.current)) return;
    dueRef.current = false;

    actOnHeldSnapshot(
      classifyHeldSnapshot({
        incomingRev: incoming.rev,
        currentRev: workflow.rev,
        incomingSignature: normalizedContentSignature(incoming),
        displayedSignature: normalizedContentSignature(workflow),
        localSignature: localContentSignature(
          nodes,
          edges,
          variables,
          workflow,
        ),
      }),
      {
        retryOnNextCanvasChange: () => {
          retryOnCanvasChangeRef.current = true;
        },
        forgetHeldSnapshot: () => {
          pendingWorkflowRef.current = null;
          retryOnCanvasChangeRef.current = false;
        },
        warnOfLostRemoteChange: () => {
          console.warn(
            "[live-updates] discarded a remote change overtaken by local edits",
            { workflowId, incomingRev: incoming.rev, localRev: workflow.rev },
          );
          toast.warning(
            "Remote changes to this workflow were overwritten by your unsaved edits",
          );
        },
        applyToCanvas: () => onWorkflowRef.current(incoming),
      },
    );
  }, [edges, nodes, pendingVersion, variables, workflow, workflowId]);
}
