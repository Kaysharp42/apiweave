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
        'sidebar-default': '450px',
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
          DEFAULT: '#164e63',   // cyan-900
          light: '#0e7490',     // cyan-700
          dark: '#083344',      // cyan-950
          hover: '#155e75',     // cyan-800
        },
        surface: {
          DEFAULT: '#f8fafc',   // slate-50 (light bg)
          raised: '#ffffff',    // white (light cards)
          overlay: '#f1f5f9',   // slate-100 (light overlays)
          dark: '#111827',      // gray-900 (dark bg)
          'dark-raised': '#1f2937', // gray-800 (dark cards)
          'dark-overlay': '#1e293b', // gray-850ish (dark overlays)
        },
        border: {
          DEFAULT: '#cbd5e1',   // slate-300 (light borders)
          dark: '#374151',      // gray-700 (dark borders)
          default: '#cbd5e1',   // alias for DEFAULT (used as border-border-default)
          'default-dark': '#374151', // alias for dark borders (used as border-border-default-dark)
        },
        'text-primary': {
          DEFAULT: '#111827',   // gray-900 (light text)
          dark: '#f3f4f6',      // gray-100 (dark text)
        },
        'text-secondary': {
          DEFAULT: '#4b5563',   // gray-600 (light secondary)
          dark: '#9ca3af',      // gray-400 (dark secondary)
        },
        'text-muted': {
          DEFAULT: '#9ca3af',   // gray-400 (light muted)
          dark: '#4b5563',      // gray-600 (dark muted)
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
        },
      },
      fontFamily: {
        sans: ['Open Sans', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
        display: ['Montserrat', 'system-ui', 'sans-serif'],
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
        'node': '0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px -1px rgba(0, 0, 0, 0.1)',
        'node-hover': '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -2px rgba(0, 0, 0, 0.1)',
        'node-selected': '0 0 0 2px rgba(22, 78, 99, 0.5)',
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
          'primary': '#164e63',
          'primary-content': '#ffffff',
          'secondary': '#0e7490',
          'secondary-content': '#ffffff',
          'accent': '#7c3aed',
          'accent-content': '#ffffff',
          'neutral': '#1f2937',
          'neutral-content': '#f3f4f6',
          'base-100': '#f8fafc',
          'base-200': '#f1f5f9',
          'base-300': '#e2e8f0',
          'base-content': '#111827',
          'info': '#2563eb',
          'info-content': '#ffffff',
          'success': '#16a34a',
          'success-content': '#ffffff',
          'warning': '#f59e0b',
          'warning-content': '#111827',
          'error': '#dc2626',
          'error-content': '#ffffff',
        },
      },
      {
        'apiweave-dark': {
          'primary': '#22d3ee',
          'primary-content': '#083344',
          'secondary': '#06b6d4',
          'secondary-content': '#083344',
          'accent': '#a78bfa',
          'accent-content': '#1e1b4b',
          'neutral': '#374151',
          'neutral-content': '#f3f4f6',
          'base-100': '#111827',
          'base-200': '#1f2937',
          'base-300': '#374151',
          'base-content': '#f3f4f6',
          'info': '#3b82f6',
          'info-content': '#ffffff',
          'success': '#4ade80',
          'success-content': '#052e16',
          'warning': '#fbbf24',
          'warning-content': '#111827',
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
