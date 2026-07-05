interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_APP_VERSION?: string;
}

declare global {
  interface ImportMeta {
    readonly env: ImportMetaEnv;
  }
  interface Window {
    // Injected by the Electron desktop shell's preload before any bundled JS
    // runs; carries the backend's dynamically-allocated loopback port and the
    // per-launch token that unlocks the backend (sent as X-Desktop-Token — the
    // backend rejects requests without it). Absent in web/Docker builds.
    __APIWEAVE_RUNTIME__?: { apiUrl?: string; uiToken?: string };
    // Frameless-window controls exposed by the Electron preload; drives the
    // custom TitleBar. Absent in web/Docker builds.
    __APIWEAVE_DESKTOP__?: {
      minimize: () => void;
      toggleMaximize: () => void;
      close: () => void;
      onMaximizeChange: (cb: (maximized: boolean) => void) => () => void;
    };
  }
}

// Runtime-first resolution: the desktop app's injected port wins, then the
// build-time env var (web/Docker), then the local-dev default.
const API_BASE_URL =
  window.__APIWEAVE_RUNTIME__?.apiUrl ??
  import.meta.env.VITE_API_URL ??
  "http://localhost:8000";

export default API_BASE_URL;
