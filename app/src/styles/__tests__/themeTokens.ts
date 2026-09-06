import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Reads the real token values out of `base.css` so contrast tests measure the
 * stylesheet rather than a table someone kept up to date by hand.
 *
 * Since the neutral roles became alphas of one tint (`--aw-tint-rgb`), a
 * resolver that only understood hex literals could no longer see them — hence
 * the alpha compositing here: a colour is only readable once it is drawn over
 * a surface, and that surface is now part of the answer.
 */

const BASE_CSS = readFileSync(join("src", "styles", "base.css"), "utf-8");

export type Theme = "light" | "dark";

export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** `:root` comes first in the file, `.dark` second. */
function scopeFor(theme: Theme): string {
  const darkStart = BASE_CSS.indexOf(".dark,");
  return theme === "light"
    ? BASE_CSS.slice(0, darkStart)
    : BASE_CSS.slice(darkStart);
}

function declaration(name: string, theme: Theme): string | undefined {
  const match = scopeFor(theme).match(new RegExp(`--${name}:\s*([^;]+);`));
  return match?.[1]?.trim();
}

/**
 * Dark inherits any declaration it does not repeat — but the *value* still
 * resolves in dark. `--aw-surface: rgb(var(--aw-surface-rgb))` is written once
 * in `:root`; dark only overrides the channels, so resolving that inherited
 * declaration in light would hand back the light surface.
 */
function inheritedDeclaration(name: string, theme: Theme): string | undefined {
  return declaration(name, theme) ?? (theme === "dark" ? declaration(name, "light") : undefined);
}

function fromHex(hex: string): Rgba {
  const clean = hex.slice(1);
  const full =
    clean.length === 3
      ? clean
          .split("")
          .map((c) => c + c)
          .join("")
      : clean;
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
    a: full.length === 8 ? parseInt(full.slice(6, 8), 16) / 255 : 1,
  };
}

/**
 * Resolve a token to literal channels in one theme, following `var(--other)`
 * aliases, channel triples (`9 9 11`) and the `rgb(var(--x) / a)` alpha form.
 */
export function tokenColor(name: string, theme: Theme, depth = 0): Rgba {
  if (depth > 4) throw new Error(`--${name} alias chain too deep`);

  const value = inheritedDeclaration(name, theme);
  if (value === undefined) {
    throw new Error(`--${name} is not declared in ${theme}`);
  }

  if (/^#[0-9a-fA-F]{3,8}$/.test(value)) return fromHex(value);

  const channels = value.match(/^(\d+)\s+(\d+)\s+(\d+)$/);
  if (channels) {
    return {
      r: Number(channels[1]),
      g: Number(channels[2]),
      b: Number(channels[3]),
      a: 1,
    };
  }

  const alias = value.match(/^var\(--([\w-]+)\)$/);
  if (alias?.[1] !== undefined) return tokenColor(alias[1], theme, depth + 1);

  // `rgb(var(--other))`, `rgb(var(--other) / 0.45)`, and the alpha-token form
  // `rgb(var(--other) / var(--aw-a-muted))` — how a role's alpha becomes a
  // theme-owned value in its own right.
  const composed = value.match(
    /^rgb\(var\(--([\w-]+)\)(?:\s*\/\s*(var\(--[\w-]+\)|[\d.]+))?\)$/,
  );
  if (composed?.[1] !== undefined) {
    const base = tokenColor(composed[1], theme, depth + 1);
    const alpha = composed[2];
    if (alpha === undefined) return base;
    return { ...base, a: tokenAlpha(alpha, theme, depth + 1) };
  }

  throw new Error(`--${name} in ${theme} is not a resolvable colour: ${value}`);
}

/** An alpha slot: either a literal or a `var(--aw-a-*)` scalar token. */
function tokenAlpha(value: string, theme: Theme, depth: number): number {
  const alias = value.match(/^var\(--([\w-]+)\)$/);
  if (alias?.[1] === undefined) return Number(value);
  if (depth > 4) throw new Error(`alpha alias chain too deep: ${value}`);

  const declared = inheritedDeclaration(alias[1], theme);
  if (declared === undefined) {
    throw new Error(`--${alias[1]} is not declared in ${theme}`);
  }
  return tokenAlpha(declared, theme, depth + 1);
}

/** Composite a translucent foreground over an opaque background. */
export function over(fg: Rgba, bg: Rgba): Rgba {
  if (bg.a !== 1) throw new Error("background must be opaque");
  return {
    r: fg.a * fg.r + (1 - fg.a) * bg.r,
    g: fg.a * fg.g + (1 - fg.a) * bg.g,
    b: fg.a * fg.b + (1 - fg.a) * bg.b,
    a: 1,
  };
}

function relativeLuminance({ r, g, b }: Rgba): number {
  const [lr, lg, lb] = [r, g, b].map((channel) => {
    const value = channel / 255;
    return value <= 0.03928
      ? value / 12.92
      : Math.pow((value + 0.055) / 1.055, 2.4);
  }) as [number, number, number];
  return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
}

/** WCAG contrast of a (possibly translucent) foreground on a surface. */
export function contrast(fg: Rgba, surface: Rgba): number {
  const [hi, lo] = [
    relativeLuminance(over(fg, surface)),
    relativeLuminance(surface),
  ].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** Whether a theme writes this token down itself, rather than inheriting it. */
export function isDeclared(name: string, theme: Theme): boolean {
  return declaration(name, theme) !== undefined;
}
