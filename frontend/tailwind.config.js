/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      // Semantic width tokens (replacing ad-hoc numeric hacks)
      width: {
        'nav-collapsed': '56px',
        'nav-expanded': '180px',
        'sidebar-default': '380px',
        'node-compact': '200px',
      },
      minWidth: {
        'nav-collapsed': '56px',
        'node-compact': '200px',
      },
      maxWidth: {
        'node': '320px',
        'sidebar': '600px',
      },
      // Design tokens — semantic color system
      colors: {
        primary: {
          DEFAULT: '#0d5c6e',   // refined cyan-900
          light: '#0e7a8a',     // refined cyan-700
          dark: '#083a45',      // refined cyan-950
          hover: '#0e6b7d',     // refined cyan-800
        },
        surface: {
          DEFAULT: '#f6f5f3',   // warm off-white (light bg)
          raised: '#ffffff',    // white (light cards)
          overlay: '#eeede9',   // warm light gray (light overlays)
          dark: '#1c1b19',      // warm very dark (dark bg)
          'dark-raised': '#2a2926', // warm dark gray (dark cards)
          'dark-overlay': '#363431', // warm medium-dark gray (dark overlays)
        },
        border: {
          DEFAULT: '#d6d2cc',   // warm mid-tone (light borders)
          dark: '#4a4743',      // warm dark (dark borders)
          default: '#d6d2cc',   // alias for DEFAULT (used as border-border-default)
          'default-dark': '#4a4743', // alias for dark borders (used as border-border-default-dark)
          focus: '#0d5c6e',     // focus ring border (light)
          'focus-dark': '#22d3ee', // focus ring border (dark)
        },
        'text-primary': {
          DEFAULT: '#1c1917',   // very dark warm gray (light text)
          dark: '#f5f4f2',      // warm off-white (dark text)
        },
        'text-secondary': {
          DEFAULT: '#5e5a55',   // warm medium gray (light secondary)
          dark: '#b8b4ae',      // warm light gray (dark secondary)
        },
        'text-muted': {
          DEFAULT: '#9e9a94',   // warm light gray (light muted)
          dark: '#6b6863',      // warm mid gray (dark muted)
        },
        status: {
          success: '#16a34a',   // green-600
          error: '#dc2626',     // red-600
          warning: '#f59e0b',   // amber-500
          running: '#eab308',   // yellow-500
          info: '#2563eb',      // blue-600
        },
        method: {
          get: '#16a34a',       // green-600
          post: '#2563eb',      // blue-600
          put: '#ea580c',       // orange-600
          patch: '#7c3aed',     // violet-600
          delete: '#dc2626',    // red-600
          head: '#0e7490',      // cyan-700
          options: '#7c3aed',   // violet-600
        },
      },
      fontFamily: {
        sans: ['Plus Jakarta Sans', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
        display: ['Plus Jakarta Sans', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'Consolas', 'monospace'],
      },
      // Consistent spacing / sizing tokens
      height: {
        'header': '48px',
        'footer': '32px',
      },
      fontSize: {
        'xxs': ['0.625rem', { lineHeight: '0.875rem' }],  // 10px
      },
      boxShadow: {
        'node': '0 1px 3px rgba(0, 0, 0, 0.08), 0 1px 2px rgba(0, 0, 0, 0.04)',
        'node-hover': '0 4px 6px rgba(0, 0, 0, 0.06), 0 2px 4px rgba(0, 0, 0, 0.04)',
        'node-selected': '0 0 0 2px rgba(13, 92, 110, 0.5)',
        'raised': '0 1px 3px rgba(0, 0, 0, 0.08), 0 1px 2px rgba(0, 0, 0, 0.04)',
        'overlay': '0 4px 6px rgba(0, 0, 0, 0.06), 0 2px 4px rgba(0, 0, 0, 0.04)',
        'modal': '0 10px 25px rgba(0, 0, 0, 0.1), 0 8px 10px rgba(0, 0, 0, 0.04)',
        'popover': '0 20px 50px rgba(0, 0, 0, 0.12), 0 12px 24px rgba(0, 0, 0, 0.06)',
      },
      animation: {
        'pulse-border': 'pulse-border 2s ease-in-out infinite',
      },
      keyframes: {
        'pulse-border': {
          '0%, 100%': { borderColor: 'rgba(234, 179, 8, 0.4)' },
          '50%': { borderColor: 'rgba(234, 179, 8, 1)' },
        },
      },
    },
  },
  plugins: [
    require('daisyui'),
  ],
  daisyui: {
    themes: [
      {
        apiweave: {
          'primary': '#0d5c6e',
          'primary-content': '#ffffff',
          'secondary': '#0e7a8a',
          'secondary-content': '#ffffff',
          'accent': '#7c3aed',
          'accent-content': '#ffffff',
          'neutral': '#2a2926',
          'neutral-content': '#f5f4f2',
          'base-100': '#f6f5f3',
          'base-200': '#eeede9',
          'base-300': '#d6d2cc',
          'base-content': '#1c1917',
          'info': '#2563eb',
          'info-content': '#ffffff',
          'success': '#16a34a',
          'success-content': '#ffffff',
          'warning': '#f59e0b',
          'warning-content': '#1c1917',
          'error': '#dc2626',
          'error-content': '#ffffff',
        },
      },
      {
        'apiweave-dark': {
          'primary': '#22d3ee',
          'primary-content': '#083a45',
          'secondary': '#06b6d4',
          'secondary-content': '#083a45',
          'accent': '#a78bfa',
          'accent-content': '#1e1b4b',
          'neutral': '#4a4743',
          'neutral-content': '#f5f4f2',
          'base-100': '#1c1b19',
          'base-200': '#2a2926',
          'base-300': '#4a4743',
          'base-content': '#f5f4f2',
          'info': '#3b82f6',
          'info-content': '#ffffff',
          'success': '#4ade80',
          'success-content': '#052e16',
          'warning': '#fbbf24',
          'warning-content': '#1c1917',
          'error': '#f87171',
          'error-content': '#450a0a',
        },
      },
    ],
    darkTheme: 'apiweave-dark',
    base: true,
    styled: true,
    utils: true,
    logs: false,
  },
}
