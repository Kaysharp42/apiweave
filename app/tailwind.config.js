/**
 * The quiet neutral roles (border, secondary text, muted text) are alphas of
 * one tint — `--aw-tint-rgb` in `src/styles/base.css`, which is the single
 * value a theme flips. The function form is what keeps opacity modifiers
 * working: `border-border/50` is half a hairline. A plain
 * `"rgb(var(--aw-tint-rgb) / 0.1)"` string would make Tailwind drop the
 * modified utility altogether, silently.
 */
const tint =
  (alpha) =>
  ({ opacityValue }) =>
    opacityValue === undefined
      ? `rgb(var(--aw-tint-rgb) / ${alpha})`
      : `rgb(var(--aw-tint-rgb) / calc(${alpha} * ${opacityValue}))`;

/** A surface channel triple, still modifier-aware (`bg-surface/90`). */
const surface = (name) => `rgb(var(${name}) / <alpha-value>)`;

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      // Semantic width tokens (replacing ad-hoc numeric hacks)
      width: {
        "nav-collapsed": "44px",
        "nav-expanded": "146px",
        "sidebar-default": "380px",
        "node-compact": "200px",
      },
      minWidth: {
        "nav-collapsed": "44px",
        "node-compact": "200px",
      },
      maxWidth: {
        node: "320px",
        sidebar: "600px",
      },
      // Design tokens — semantic color system (zinc neutrals + ink-teal accent)
      colors: {
        primary: {
          DEFAULT: "#0d5c6e", // ink-teal accent (light)
          light: "#0f766e", // teal-700
          dark: "#0b3d49", // deep ink-teal (pressed)
          hover: "#0b4a59", // accent hover (light)
        },
        // Every role below resolves through a custom property, so base.css is
        // the only place a neutral value is written down.
        //
        // The `*-dark` keys are deprecated twins kept alive on purpose: every
        // one of them is used behind a `dark:` variant, so pointing them at
        // the same theme-aware value is a no-op. They go away with the
        // `dark:` classes themselves.
        surface: {
          DEFAULT: surface("--aw-surface-rgb"),
          raised: surface("--aw-surface-raised-rgb"),
          overlay: surface("--aw-surface-overlay-rgb"),
          dark: surface("--aw-surface-rgb"),
          "dark-raised": surface("--aw-surface-raised-rgb"),
          "dark-overlay": surface("--aw-surface-overlay-rgb"),
        },
        border: {
          DEFAULT: tint(0.1),
          dark: tint(0.1),
          default: tint(0.1),
          "default-dark": tint(0.1),
          focus: "var(--aw-border-focus)",
          "focus-dark": "var(--aw-border-focus)",
        },
        "text-primary": {
          DEFAULT: "var(--aw-text-primary)",
          dark: "var(--aw-text-primary)",
        },
        "text-secondary": {
          DEFAULT: tint(0.65),
          dark: tint(0.65),
        },
        "text-muted": {
          DEFAULT: tint(0.45),
          dark: tint(0.45),
        },
        status: {
          success: "#15803d", // green-700
          error: "#b91c1c", // red-700
          warning: "#b45309", // amber-700
          running: "#a16207", // yellow-700
          info: "#1d4ed8", // blue-700
        },
        method: {
          get: "#15803d",
          post: "#1d4ed8",
          put: "#b45309",
          patch: "#6d28d9",
          delete: "#b91c1c",
          head: "#0f766e",
          options: "#6d28d9",
        },
      },
      fontFamily: {
        sans: [
          "Inter",
          "system-ui",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "Roboto",
          "sans-serif",
        ],
        display: ["Inter", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "Fira Code", "Consolas", "monospace"],
      },
      // Consistent spacing / sizing tokens
      height: {
        header: "48px",
        footer: "32px",
      },
      fontSize: {
        xxs: ["0.625rem", { lineHeight: "0.875rem" }], // 10px
      },
      // Node layer radius — the canvas only (DESIGN.md §7). The chrome keeps
      // Tailwind's default scale; this family is additive and scoped by name.
      borderRadius: {
        node: "var(--aw-radius-node)", // 14px — the node slab
        "node-tile": "var(--aw-radius-node-tile)", // 8px — 28px icon tile
        "node-ctl": "var(--aw-radius-node-ctl)", // 8px — selects, inputs, menu items
        "node-chip": "var(--aw-radius-node-chip)", // 6px — method pill, badges
        "node-rail": "var(--aw-radius-node-rail)", // pill — rail, status dot, midpoints
      },
      boxShadow: {
        // Swiss minimalism: separation via hairline borders, not heavy shadows.
        node: "0 1px 2px rgba(0, 0, 0, 0.04)",
        "node-hover": "0 2px 4px rgba(0, 0, 0, 0.06)",
        "node-selected": "0 0 0 2px var(--aw-primary)",
        raised: "none",
        overlay: "0 2px 8px rgba(0, 0, 0, 0.04)",
        modal: "0 8px 24px rgba(0, 0, 0, 0.08)",
        popover: "0 12px 32px rgba(0, 0, 0, 0.10)",
        // Node layer — theme-aware via the custom properties they read.
        "node-raised": "var(--aw-shadow-node-raised)",
        "glow-running": "var(--aw-glow-running)",
        "glow-error": "var(--aw-glow-error)",
        "glow-warning": "var(--aw-glow-warning)",
        "glow-success": "var(--aw-glow-success)",
        "glow-select": "var(--aw-glow-select)",
      },
      transitionTimingFunction: {
        "aw-out": "var(--aw-ease-out)",
        "aw-in": "var(--aw-ease-in)",
        "aw-standard": "var(--aw-ease-standard)",
      },
      transitionDuration: {
        instant: "var(--aw-dur-instant)",
        "aw-fast": "var(--aw-dur-fast)",
        "aw-normal": "var(--aw-dur-normal)",
        settle: "var(--aw-dur-settle)",
      },
      // Keyframes are defined once in `src/styles/node-motion.css` and
      // referenced by name here, so each one has a single source. Retired:
      // `pulse-border`, which animated `border-color` in a loop.
      animation: {
        "node-breathe": "aw-node-breathe 2.4s ease-in-out infinite",
        "node-settle": "aw-node-settle var(--aw-dur-settle) var(--aw-ease-out) forwards",
        "rail-sweep": "aw-rail-sweep 1.4s linear infinite",
        // Same duration and curve as the `.aw-edge-fill` reveal in
        // `node-motion.css`, so the head never drifts off the colour it leads.
        "edge-fill": "aw-edge-fill var(--aw-dur-edge-fill) var(--aw-ease-travel) forwards",
        "strip-enter": "aw-strip-enter var(--aw-dur-normal) var(--aw-ease-out)",
      },
    },
  },
  plugins: [require("daisyui")],
  // A hand-maintained mirror of the palette, and knowingly so: daisyUI's theme
  // block takes hexes, so it cannot read `--aw-tint-rgb` or the surface
  // channels. Change a value here only alongside `src/styles/base.css`. The
  // honest fix is to drop daisyUI theming entirely and let the `--aw-*` tokens
  // be the only source, which needs an audit of what still uses daisyUI
  // component classes first.
  daisyui: {
    themes: [
      {
        apiweave: {
          primary: "#0d5c6e",
          "primary-content": "#ffffff",
          secondary: "#0f766e",
          "secondary-content": "#ffffff",
          accent: "#0d5c6e",
          "accent-content": "#ffffff",
          neutral: "#18181b",
          "neutral-content": "#fafafa",
          "base-100": "#fafafa",
          "base-200": "#f4f4f5",
          "base-300": "#e4e4e7",
          "base-content": "#09090b",
          info: "#1d4ed8",
          "info-content": "#ffffff",
          success: "#15803d",
          "success-content": "#ffffff",
          warning: "#b45309",
          "warning-content": "#ffffff",
          error: "#b91c1c",
          "error-content": "#ffffff",
        },
      },
      {
        "apiweave-dark": {
          primary: "#2dd4bf",
          "primary-content": "#042f2e",
          secondary: "#0d5c6e",
          "secondary-content": "#fafafa",
          accent: "#2dd4bf",
          "accent-content": "#042f2e",
          neutral: "#27272a",
          "neutral-content": "#fafafa",
          "base-100": "#09090b",
          "base-200": "#18181b",
          "base-300": "#27272a",
          "base-content": "#fafafa",
          info: "#3b82f6",
          "info-content": "#ffffff",
          success: "#4ade80",
          "success-content": "#052e16",
          warning: "#fbbf24",
          "warning-content": "#1c1917",
          error: "#f87171",
          "error-content": "#450a0a",
        },
      },
    ],
    darkTheme: "apiweave-dark",
    base: true,
    styled: true,
    utils: true,
    logs: false,
  },
};
