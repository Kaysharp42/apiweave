import { createDisclosureStore } from "./disclosureStore";

/**
 * Whether the About dialog is showing. A store rather than local state because
 * two unrelated triggers open it: the footer's version pill and the command
 * palette's "About APIWeave".
 */
const useAboutStore = createDisclosureStore();

/** Open About from outside React (the command palette's command handler). */
export function openAbout(): void {
  useAboutStore.getState().open();
}

export default useAboutStore;
