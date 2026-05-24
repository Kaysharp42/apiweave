interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_APIWEAVE_ADMIN_KEY?: string;
}

declare global {
  interface ImportMeta {
    readonly env: ImportMetaEnv;
  }
}

const API_BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:8000';

export const APIWEAVE_ADMIN_KEY = import.meta.env.VITE_APIWEAVE_ADMIN_KEY;

export default API_BASE_URL;
