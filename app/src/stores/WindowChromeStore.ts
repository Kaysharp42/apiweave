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
}

const useWindowChromeStore = create<WindowChromeState>()((set) => ({
  headerOwnsChrome: false,
  setHeaderOwnsChrome: (owns: boolean) => set({ headerOwnsChrome: owns }),
}));

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
