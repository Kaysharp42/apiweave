import { create } from "zustand";
import { toast } from "sonner";
import useTabStore from "./TabStore";
import { authenticatedFetch, workflowDetailUrl } from "../utils/apiweaveClient";
import {
  describeThrownSaveError,
  readSaveFailureEnvelope,
} from "../utils/workflowSaveFailure";
import { WorkflowSchema } from "@shared/zod-schemas/WorkflowSchema";
import type { PendingEdits } from "../types/PendingEdits";
import type { UnsavedChangesChoice } from "../types/UnsavedChangesChoice";

/**
 * The unsaved-changes guard in front of everything that throws a tab's work
 * away: closing it, signing out, and quitting the app.
 *
 * Only the active tab mounts a canvas; it registers itself here while mounted.
 * Every other tab's unsaved work is the draft its canvas left on the tab as it
 * unmounted (see `useCanvasPendingEdits`).
 */
interface PendingEditsState {
  /** Name of the workflow the unsaved-changes dialog is asking about. */
  promptFor: string | null;
  answer: (choice: UnsavedChangesChoice) => void;
}

const registered = new Map<string, PendingEdits>();
let resolvePrompt: ((choice: UnsavedChangesChoice) => void) | null = null;

const usePendingEditsStore = create<PendingEditsState>()((set) => ({
  promptFor: null,
  answer: (choice) => {
    const resolve = resolvePrompt;
    resolvePrompt = null;
    set({ promptFor: null });
    resolve?.(choice);
  },
}));

function ask(name: string): Promise<UnsavedChangesChoice> {
  // One dialog at a time: a second close request supersedes the first.
  resolvePrompt?.("cancel");
  return new Promise((resolve) => {
    resolvePrompt = resolve;
    usePendingEditsStore.setState({ promptFor: name });
  });
}

export function registerPendingEdits(
  workflowId: string,
  edits: PendingEdits,
): () => void {
  registered.set(workflowId, edits);
  return () => {
    if (registered.get(workflowId) === edits) registered.delete(workflowId);
  };
}

/**
 * Resolves whether the canvas may be thrown away. A pending auto-save is sent
 * first; whatever is still unsaved after that — auto-save off, or a save that
 * failed — is the user's call. "Save" that fails again keeps the canvas open.
 */
export async function settlePendingEdits(
  edits: PendingEdits,
  askUser: () => Promise<UnsavedChangesChoice>,
): Promise<boolean> {
  await edits.flush();
  if (!edits.isUnsaved()) return true;
  const choice = await askUser();
  if (choice === "cancel") return false;
  if (choice === "discard") return true;
  await edits.save();
  return !edits.isUnsaved();
}

const findTab = (id: string) =>
  useTabStore.getState().tabs.find((t) => t.id === id);

/**
 * Saves a tab's draft without a canvas — the same PATCH the canvas's explicit
 * save sends. A failure is reported and leaves the draft, and so the tab, as
 * they were.
 */
async function saveDraft(id: string): Promise<void> {
  const tab = findTab(id);
  if (!tab?.draft) return;
  const { draft } = tab;
  try {
    const response = await authenticatedFetch(
      workflowDetailUrl(tab.workspaceId, tab.workflowId),
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nodes: draft.nodes,
          edges: draft.edges,
          variables: draft.variables,
          selectedEnvironmentId: draft.selectedEnvironmentId ?? null,
          // The draft was cut from the tab's workflow at this revision; a
          // newer one on the server is someone else's edit, not ours to replace.
          expectedRevision: draft.rev,
        }),
      },
    );
    if (!response.ok) {
      const { detail, code, issues } = await readSaveFailureEnvelope(response);
      throw new Error(
        code === "conflict"
          ? "it was changed elsewhere since you edited it. Open it to choose which version to keep."
          : (detail ?? issues[0] ?? `the request was rejected (${response.status})`),
      );
    }
    const saved = WorkflowSchema.parse(await response.json());
    useTabStore.getState().updateTabWorkflow(id, saved);
    useTabStore.getState().markClean(id);
  } catch (error) {
    const cause = describeThrownSaveError(error);
    toast.error(
      `Failed to save "${tab.name}" — ${cause ?? "your changes are not saved"}`,
      { id: `workflow-save-error-${id}` },
    );
  }
}

/** The mounted canvas, or else the draft an unmounted one left on the tab. */
function pendingEditsFor(id: string): PendingEdits | undefined {
  const mounted = registered.get(id);
  if (mounted) return mounted;
  if (!findTab(id)?.draft) return undefined;
  return {
    flush: () => Promise.resolve(),
    isUnsaved: () => findTab(id)?.draft !== undefined,
    save: () => saveDraft(id),
  };
}

/** Whether the given tabs may close; prompts for each one with unsaved work. */
export async function confirmCloseTabs(
  tabIds: readonly string[],
): Promise<boolean> {
  for (const id of tabIds) {
    const edits = pendingEditsFor(id);
    if (!edits) continue;
    const name = findTab(id)?.name ?? "Untitled";
    if (!(await settlePendingEdits(edits, () => ask(name)))) return false;
  }
  return true;
}

/**
 * The quit and sign-out path: every open tab, in every workspace, settled
 * before its work may be dropped.
 */
export function confirmCloseAll(): Promise<boolean> {
  return confirmCloseTabs(useTabStore.getState().tabs.map((t) => t.id));
}

export default usePendingEditsStore;
