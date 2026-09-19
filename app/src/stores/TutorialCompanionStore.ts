import { create } from "zustand";
import type { TutorialCompanionState } from "../types";

/**
 * Ephemeral presentation state for the follow-along companion.
 *
 * Deliberately not persisted: the plan requires that a reload restores the
 * practice position but leaves the companion closed, so only the progress
 * store survives. A module-level store (rather than a context) lets the shell
 * overlay and the reader's "Follow along" action share one instance without
 * threading props through the layout.
 */
const useTutorialCompanionStore = create<TutorialCompanionState>()((set) => ({
  isOpen: false,
  isCollapsed: false,
  isExpanded: false,
  returnPath: null,

  openCompanion: (returnPath: string) =>
    set({
      isOpen: true,
      isCollapsed: false,
      isExpanded: false,
      returnPath,
    }),

  collapseCompanion: () =>
    set({ isOpen: true, isCollapsed: true, isExpanded: false }),

  expandCompanion: () =>
    set({ isOpen: true, isCollapsed: false, isExpanded: true }),

  closeCompanion: () =>
    set({
      isOpen: false,
      isCollapsed: false,
      isExpanded: false,
      returnPath: null,
    }),

  pauseCompanion: () =>
    set({ isOpen: false, isCollapsed: false, isExpanded: false }),
}));

export default useTutorialCompanionStore;
