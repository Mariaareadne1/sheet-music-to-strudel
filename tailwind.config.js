/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  // Class-based dark mode so we can toggle via data-theme on the root element
  darkMode: 'class',
  theme: {
    extend: {
      // Map Tailwind color names to CSS custom properties so every component
      // automatically re-colors when the theme changes
      colors: {
        bg:             'var(--bg)',
        surface:        'var(--surface)',
        'surface-raised': 'var(--surface-raised)',
        border:         'var(--border)',
        'border-subtle':'var(--border-subtle)',
        'text-primary': 'var(--text-primary)',
        'text-secondary':'var(--text-secondary)',
        'text-dim':     'var(--text-dim)',
        accent:         'var(--accent)',
        'accent-hover': 'var(--accent-hover)',
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Fira Code', 'Consolas', 'monospace'],
      },
    },
  },
  plugins: [],
}
