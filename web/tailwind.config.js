/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        hvac: {
          heat: '#f59e0b',
          cool: '#3b82f6',
          auto: '#10b981',
          fan: '#06b6d4',
          dry: '#8b5cf6',
          off: '#64748b',
        }
      }
    },
  },
  plugins: [],
}
