/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './src/**/*.{js,ts,jsx,tsx,mdx}',
    // Utility classes used by the shared @ima-jin/ui components (NavBar, toasts, footer).
    './node_modules/@ima-jin/ui/dist/**/*.js',
  ],
  darkMode: 'class',
  theme: {
    extend: {},
  },
  plugins: [],
};
