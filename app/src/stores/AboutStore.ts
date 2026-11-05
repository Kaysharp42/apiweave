import { create } from "zustand";

interface AboutState {
  isOpen: boolean;
  open: () => void;
  close: () => void;
}

/**
 * Whether the About dialog is showing. A store rather than local state because
 * two unrelated triggers open it: the footer's version pill and the command
 * palette's "About APIWeave".
 */
const useAboutStore = create<AboutState>()((set) => ({
  isOpen: false,
  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
}));

/** Open About from outside React (the command palette's command handler). */
export function openAbout(): void {
  useAboutStore.getState().open();
}

export default useAboutStore;
