import { create } from "zustand";
import type { DisclosureState } from "../types";

/**
 * The store behind a dialog with no state but "is it showing".
 *
 * The About dialog and the keyboard-shortcuts help each have a second trigger
 * outside the component that renders them (the command palette), so neither can
 * own the flag locally — and beyond that flag they have nothing to store.
 */
export function createDisclosureStore() {
  return create<DisclosureState>()((set) => ({
    isOpen: false,
    open: () => set({ isOpen: true }),
    close: () => set({ isOpen: false }),
  }));
}
