import { afterEach, describe, expect, it } from "vitest";
import {
  createGuardedLocalStorage,
  guardedStorage,
} from "./guardedStorage";
import type { GuardedStorage } from "../types";

/** A storage whose every method throws, as quota/security failures do. */
function throwingStorage(): GuardedStorage {
  return {
    getItem: () => {
      throw new Error("SecurityError: storage disabled");
    },
    setItem: () => {
      throw new Error("QuotaExceededError");
    },
    removeItem: () => {
      throw new Error("QuotaExceededError");
    },
  };
}

/** A minimal in-memory storage for the happy path. */
function memoryStorage(): GuardedStorage {
  const map = new Map<string, string>();
  return {
    getItem: (name) => map.get(name) ?? null,
    setItem: (name, value) => {
      map.set(name, value);
    },
    removeItem: (name) => {
      map.delete(name);
    },
  };
}

describe("guardedStorage", () => {
  it("passes through reads and writes when storage works", () => {
    const memory = memoryStorage();
    const store = guardedStorage(() => memory);
    store.setItem("k", "v");
    expect(store.getItem("k")).toBe("v");
    store.removeItem("k");
    expect(store.getItem("k")).toBeNull();
  });

  it("returns null from getItem instead of throwing", () => {
    const store = guardedStorage(throwingStorage);
    expect(() => store.getItem("k")).not.toThrow();
    expect(store.getItem("k")).toBeNull();
  });

  it("swallows setItem and removeItem failures", () => {
    const store = guardedStorage(throwingStorage);
    expect(() => store.setItem("k", "v")).not.toThrow();
    expect(() => store.removeItem("k")).not.toThrow();
  });

  it("tolerates a storage accessor that itself throws", () => {
    const store = guardedStorage(() => {
      throw new Error("access denied");
    });
    expect(store.getItem("k")).toBeNull();
    expect(() => store.setItem("k", "v")).not.toThrow();
  });

  it("tolerates a missing storage", () => {
    const store = guardedStorage(() => undefined);
    expect(store.getItem("k")).toBeNull();
    expect(() => store.setItem("k", "v")).not.toThrow();
  });
});

describe("createGuardedLocalStorage", () => {
  const original = Object.getOwnPropertyDescriptor(window, "localStorage");

  afterEach(() => {
    if (original !== undefined) {
      Object.defineProperty(window, "localStorage", original);
    }
  });

  it("uses the real localStorage when it is available", () => {
    const store = createGuardedLocalStorage();
    store.setItem("guarded-test", "1");
    expect(localStorage.getItem("guarded-test")).toBe("1");
    store.removeItem("guarded-test");
  });

  it("degrades to a no-op when accessing localStorage throws", () => {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw new Error("storage disabled");
      },
    });
    const store = createGuardedLocalStorage();
    expect(store.getItem("k")).toBeNull();
    expect(() => store.setItem("k", "v")).not.toThrow();
  });
});
