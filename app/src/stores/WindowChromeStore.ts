import { useEffect } from "react";
import { create } from "zustand";
import { isDesktopShell } from "../utils/isDesktopShell";

interface WindowChromeState {
  /**
   * True while a routed header (MainHeader) is mounted and drawing the window
   * chrome itself. TitleBar renders nothing in that case, so the desktop app
   * shows a single bar instead of stacking its title bar above the app header.
   */
  headerOwnsChrome: boolean;
  setHeaderOwnsChrome: (owns: boolean) => void;
  /**
   * How many dialog backdrops are on screen. A count, not a flag: a confirm
   * can open over a dialog, and closing it must not undim the one beneath.
   */
  backdrops: number;
  addBackdrop: () => void;
  removeBackdrop: () => void;
}

const useWindowChromeStore = create<WindowChromeState>()((set) => ({
  headerOwnsChrome: false,
  setHeaderOwnsChrome: (owns: boolean) => set({ headerOwnsChrome: owns }),
  backdrops: 0,
  addBackdrop: () => set((state) => ({ backdrops: state.backdrops + 1 })),
  removeBackdrop: () =>
    set((state) => ({ backdrops: Math.max(0, state.backdrops - 1) })),
}));

/**
 * Counts the calling backdrop as dimming the page while it is mounted. The
 * native window controls sit above the page, where no backdrop reaches, so
 * the app asks main to dim them too while any backdrop is up.
 */
export function useDimsWindow(): void {
  const addBackdrop = useWindowChromeStore((s) => s.addBackdrop);
  const removeBackdrop = useWindowChromeStore((s) => s.removeBackdrop);

  useEffect(() => {
    addBackdrop();
    return removeBackdrop;
  }, [addBackdrop, removeBackdrop]);
}

/**
 * Claims the window chrome for the calling header while it is mounted.
 *
 * Also flips `chrome-merged` on <html>: `.desktop-shell` reserves the standalone
 * title bar's 2rem from every h-screen page (see index.css), which would leave a
 * dead 2rem strip once TitleBar stops rendering. Routes without a header — login,
 * setup — never call this, so they keep TitleBar and the reservation.
 */
export function useOwnWindowChrome(): boolean {
  const setHeaderOwnsChrome = useWindowChromeStore((s) => s.setHeaderOwnsChrome);
  const isDesktop = isDesktopShell();

  useEffect(() => {
    if (!isDesktop) return;

    setHeaderOwnsChrome(true);
    document.documentElement.classList.add("chrome-merged");
    return () => {
      setHeaderOwnsChrome(false);
      document.documentElement.classList.remove("chrome-merged");
    };
  }, [isDesktop, setHeaderOwnsChrome]);

  return isDesktop;
}

export default useWindowChromeStore;
