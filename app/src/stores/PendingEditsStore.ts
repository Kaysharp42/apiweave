import { create } from "zustand";
import useTabStore from "./TabStore";
import type { PendingEdits } from "../types/PendingEdits";
import type { UnsavedChangesChoice } from "../types/UnsavedChangesChoice";

/**
 * The unsaved-changes guard in front of everything that throws a canvas away:
 * closing its tab, and quitting the app.
 *
 * Only the active tab mounts a canvas, so at most one workflow has live,
 * possibly-unsaved state at a time; it registers itself here while mounted.
 * A tab that is not mounted has nothing left to save.
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

/** Whether the given tabs may close; prompts for a mounted canvas among them. */
export async function confirmCloseTabs(
  tabIds: readonly string[],
): Promise<boolean> {
  for (const id of tabIds) {
    const edits = registered.get(id);
    if (!edits) continue;
    const name =
      useTabStore.getState().tabs.find((t) => t.id === id)?.name ?? "Untitled";
    if (!(await settlePendingEdits(edits, () => ask(name)))) return false;
  }
  return true;
}

/** The quit path: every mounted canvas, settled before main may exit. */
export function confirmCloseAll(): Promise<boolean> {
  return confirmCloseTabs([...registered.keys()]);
}

export default usePendingEditsStore;
