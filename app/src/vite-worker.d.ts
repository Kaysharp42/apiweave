// Ambient declaration for Vite's `?worker` import suffix used by the locally
// bundled Monaco editor workers (see src/config/monaco.ts). Declared locally
// rather than via `vite/client` so the project's existing CSS-module /
// ImportMetaEnv conventions are unaffected.
declare module "*?worker" {
  const workerConstructor: {
    new (options?: { name?: string }): Worker;
  };
  export default workerConstructor;
}