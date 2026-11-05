import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveDarkMode, useThemePreference } from "./useThemePreference";

type ChangeListener = (event: MediaQueryListEvent) => void;

interface FakeColorScheme {
  matches: boolean;
  readonly listeners: Set<ChangeListener>;
}

/** The OS colour scheme, and the handle a test needs to flip it. */
function installColorScheme(startsDark: boolean): FakeColorScheme {
  const fake: FakeColorScheme = {
    matches: startsDark,
    listeners: new Set<ChangeListener>(),
  };
  const mediaQueryList = {
    get matches() {
      return fake.matches;
    },
    media: "(prefers-color-scheme: dark)",
    onchange: null,
    addEventListener: (_type: string, listener: ChangeListener) =>
      fake.listeners.add(listener),
    removeEventListener: (_type: string, listener: ChangeListener) =>
      fake.listeners.delete(listener),
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => true,
  } as unknown as MediaQueryList;
  vi.stubGlobal("matchMedia", () => mediaQueryList);
  return fake;
}

function flipColorScheme(fake: FakeColorScheme, matches: boolean): void {
  fake.matches = matches;
  const event = { matches } as MediaQueryListEvent;
  for (const listener of fake.listeners) listener(event);
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("resolveDarkMode", () => {
  it("follows the OS only when the preference is system", () => {
    expect(resolveDarkMode("system", true)).toBe(true);
    expect(resolveDarkMode("system", false)).toBe(false);
    expect(resolveDarkMode("light", true)).toBe(false);
    expect(resolveDarkMode("dark", false)).toBe(true);
  });
});

describe("useThemePreference", () => {
  it("defaults to system and resolves from prefers-color-scheme", () => {
    installColorScheme(true);

    const { result } = renderHook(() => useThemePreference());

    expect(result.current.themePreference).toBe("system");
    expect(result.current.darkMode).toBe(true);
  });

  it("follows the OS live while the preference is system", () => {
    const fake = installColorScheme(false);
    const { result } = renderHook(() => useThemePreference());

    expect(result.current.darkMode).toBe(false);

    act(() => flipColorScheme(fake, true));

    expect(result.current.darkMode).toBe(true);
  });

  it("lets an explicit preference override a dark OS", () => {
    installColorScheme(true);
    localStorage.setItem("apiweave:v1:themePreference", "light");

    const { result } = renderHook(() => useThemePreference());

    expect(result.current.themePreference).toBe("light");
    expect(result.current.darkMode).toBe(false);
  });

  it("stores an override and stops following the OS", () => {
    const fake = installColorScheme(false);
    const { result } = renderHook(() => useThemePreference());

    act(() => result.current.setThemePreference("dark"));

    expect(result.current.darkMode).toBe(true);
    expect(localStorage.getItem("apiweave:v1:themePreference")).toBe("dark");
    expect(localStorage.getItem("themePreference")).toBe("dark");

    act(() => flipColorScheme(fake, true));
    expect(result.current.darkMode).toBe(true);

    act(() => result.current.setThemePreference("light"));
    expect(result.current.darkMode).toBe(false);
  });

  it("falls back to system when the stored value is not a preference", () => {
    installColorScheme(false);
    localStorage.setItem("apiweave:v1:themePreference", "sepia");

    const { result } = renderHook(() => useThemePreference());

    expect(result.current.themePreference).toBe("system");
    expect(result.current.darkMode).toBe(false);
  });
});
