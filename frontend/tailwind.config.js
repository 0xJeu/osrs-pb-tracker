/** @type {import('tailwindcss').Config} */
export default {
  // Scoped to the Leaderboards page only - the rest of the site uses its
  // own hand-written RuneScape bitmap-font theme (theme-osrs-preview.css),
  // so Tailwind's preflight reset is disabled to avoid it clobbering that.
  corePlugins: {
    preflight: false,
  },
  content: ['./index.html', './src/components/AllBossesView.tsx'],
  theme: {
    extend: {},
  },
  plugins: [],
};
