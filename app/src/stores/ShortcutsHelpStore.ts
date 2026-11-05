import { createDisclosureStore } from "./disclosureStore";

/**
 * Whether the keyboard-shortcuts dialog is showing. A store rather than
 * Workspace state because two unrelated triggers open it: the `?` shortcut and
 * the command palette's "Keyboard shortcuts".
 */
const useShortcutsHelpStore = createDisclosureStore();

/** Open the shortcuts help from outside React (the command palette's handler). */
export function openShortcutsHelp(): void {
  useShortcutsHelpStore.getState().open();
}

export default useShortcutsHelpStore;
