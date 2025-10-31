/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class', // Enable class-based dark mode
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      width: {
        '8': '30px',
        '15': '60px',
        '25': '100px',
        '50': '200px',
      },
      minWidth: {
        '8': '30px',
        '15': '60px',
        '25': '100px',
        '50': '200px',
      },
    },
  },
  plugins: [],
}
