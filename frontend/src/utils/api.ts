interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_APP_VERSION?: string;
}

declare global {
  interface ImportMeta {
    readonly env: ImportMetaEnv;
  }
  interface Window {
    // Injected by the Tauri desktop shell before any bundled JS runs; carries
    // the backend's dynamically-allocated loopback port. Absent in web/Docker builds.
    __APIWEAVE_RUNTIME__?: { apiUrl?: string };
  }
}

// Runtime-first resolution: the desktop app's injected port wins, then the
// build-time env var (web/Docker), then the local-dev default.
const API_BASE_URL =
  window.__APIWEAVE_RUNTIME__?.apiUrl ??
  import.meta.env.VITE_API_URL ??
  "http://localhost:8000";

export default API_BASE_URL;
