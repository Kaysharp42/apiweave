import { lazy } from "react";

// Both chunks are independent (the config module only sets MonacoEnvironment /
// loader.config, which the editor reads at mount, not at import), so fetch them
// in parallel. Module imports are cached, so calling this again is free — the
// request panel warms it on mount so the ~MB editor chunk is ready before the
// user reaches the Body or Scripts tab instead of stalling on "Loading editor…".
export const loadMonaco = async () => {
  const [, editorModule] = await Promise.all([
    import("@/config/monaco"),
    import("@monaco-editor/react"),
  ]);
  return editorModule;
};

/** The Monaco editor, loaded on first render. Wrap it in `<Suspense>`. */
export const MonacoEditor = lazy(loadMonaco);

/** The Monaco diff editor, from the same lazily loaded instance. Wrap it in `<Suspense>`. */
export const MonacoDiffEditor = lazy(async () => ({
  default: (await loadMonaco()).DiffEditor,
}));
