import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

vi.stubGlobal("__APIWEAVE_IPC__", {
  invoke: vi
    .fn()
    .mockResolvedValue({ ok: true, data: { items: [], total: 0 } }),
  onRunProgress: vi.fn().mockReturnValue(() => undefined),
});

// Node 26 owns `localStorage`/`sessionStorage` on globalThis, and vitest 2's
// jsdom bridge skips any key the Node global already has unless it is on its
// own curated list — which these two are not. So jsdom's storage never lands:
// `localStorage` stays undefined (Node's is inert without --localstorage-file)
// and `sessionStorage` is Node's, shared by every test file in a worker.
// defineProperty rather than vi.stubGlobal, so vi.unstubAllGlobals() in a test
// cannot take it away again.
if (typeof window !== "undefined") {
  for (const key of ["localStorage", "sessionStorage"] as const) {
    Object.defineProperty(globalThis, key, {
      value: memoryStorage(),
      configurable: true,
      writable: true,
    });
  }
}

// jsdom's Blob has no `text()`, which Electron's renderer does; give it one
// through jsdom's own FileReader so components can read a picked file natively.
if (typeof Blob !== "undefined" && typeof Blob.prototype.text !== "function") {
  Blob.prototype.text = function text(this: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ""));
      reader.onerror = () => reject(reader.error ?? new Error("read failed"));
      reader.readAsText(this);
    });
  };
}

// ponytail: Map-backed, not jsdom's Storage — no index access (`store.foo`),
// no StorageEvent, no quota. Swap in jsdom's real one if a test needs those.
function memoryStorage(): Storage {
  const entries = new Map<string, string>();
  return {
    get length() {
      return entries.size;
    },
    key: (index: number) => [...entries.keys()][index] ?? null,
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => {
      entries.set(String(key), String(value));
    },
    removeItem: (key: string) => {
      entries.delete(key);
    },
    clear: () => entries.clear(),
  };
}
