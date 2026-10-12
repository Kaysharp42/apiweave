import { IpcError } from "./apiweaveClient";

/**
 * Restore a workflow version without losing the canvas's unsaved edits: they
 * are saved first, so the restore keeps them as a version too. A save that did
 * not land (refused, conflicted, threw) aborts the restore, because the reload
 * that follows would replace the canvas and the edits would exist nowhere.
 */
export async function restoreAfterSave(
  save: () => Promise<boolean>,
  restore: () => Promise<unknown>,
  reload: () => Promise<void>,
): Promise<void> {
  if (!(await save())) {
    throw new Error(
      "Your unsaved edits could not be saved, so the version was not restored. Fix or discard them, then restore again.",
    );
  }
  try {
    await restore();
  } catch (error) {
    if (error instanceof IpcError && error.code === "conflict") {
      throw new Error(
        "This workflow changed while you were looking. Load the latest, then restore again.",
      );
    }
    throw error;
  }
  await reload();
}
