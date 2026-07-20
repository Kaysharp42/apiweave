import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

vi.stubGlobal("__APIWEAVE_IPC__", {
  invoke: vi
    .fn()
    .mockResolvedValue({ ok: true, data: { items: [], total: 0 } }),
  onRunProgress: vi.fn().mockReturnValue(() => undefined),
});
