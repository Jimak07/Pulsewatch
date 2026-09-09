/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      colors: {
        ink: '#000000',
        paper: '#FFFFFF',
        neutral: {
          50: '#F8F8F8',
          100: '#F0F0F0',
          200: '#D9D9D9',
          300: '#B8B8B8',
          400: '#8A8A8A',
          500: '#666666',
          600: '#4A4A4A',
          700: '#333333',
          800: '#202020',
          900: '#111111',
          950: '#050505',
        },
      },
    },
  },
  plugins: [],
}
