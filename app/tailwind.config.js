/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      // Semantic width tokens (replacing ad-hoc numeric hacks)
      width: {
        "nav-collapsed": "56px",
        "nav-expanded": "180px",
        "sidebar-default": "380px",
        "node-compact": "200px",
      },
      minWidth: {
        "nav-collapsed": "56px",
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
        surface: {
          DEFAULT: "#fafafa", // zinc-50 page bg (light)
          raised: "#ffffff", // cards (light)
          overlay: "#f4f4f5", // zinc-100 overlay/hover (light)
          dark: "#09090b", // zinc-950 page bg (dark)
          "dark-raised": "#18181b", // zinc-900 cards (dark)
          "dark-overlay": "#27272a", // zinc-800 overlay/hover (dark)
        },
        border: {
          DEFAULT: "#e4e4e7", // zinc-200 hairline (light)
          dark: "#27272a", // zinc-800 hairline (dark)
          default: "#e4e4e7",
          "default-dark": "#27272a",
          focus: "#0d5c6e", // focus ring (light) = accent
          "focus-dark": "#2dd4bf", // focus ring (dark) = accent
        },
        "text-primary": {
          DEFAULT: "#09090b", // zinc-950 ink (light)
          dark: "#fafafa", // zinc-50 (dark)
        },
        "text-secondary": {
          DEFAULT: "#52525b", // zinc-600 (light)
          dark: "#a1a1aa", // zinc-400 (dark)
        },
        "text-muted": {
          DEFAULT: "#a1a1aa", // zinc-400 (light)
          dark: "#71717a", // zinc-500 (dark)
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
      boxShadow: {
        // Swiss minimalism: separation via hairline borders, not heavy shadows.
        node: "0 1px 2px rgba(0, 0, 0, 0.04)",
        "node-hover": "0 2px 4px rgba(0, 0, 0, 0.06)",
        "node-selected": "0 0 0 2px var(--aw-primary)",
        raised: "none",
        overlay: "0 2px 8px rgba(0, 0, 0, 0.04)",
        modal: "0 8px 24px rgba(0, 0, 0, 0.08)",
        popover: "0 12px 32px rgba(0, 0, 0, 0.10)",
      },
      animation: {
        "pulse-border": "pulse-border 2s ease-in-out infinite",
      },
      keyframes: {
        "pulse-border": {
          "0%, 100%": { borderColor: "rgba(234, 179, 8, 0.4)" },
          "50%": { borderColor: "rgba(234, 179, 8, 1)" },
        },
      },
    },
  },
  plugins: [require("daisyui")],
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
