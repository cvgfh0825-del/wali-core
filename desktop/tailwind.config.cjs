/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: { 950: '#070708', 900: '#0C0C0E', 850: '#111114', 800: '#16161A', 750: '#1C1C21', 700: '#24242A', 600: '#2E2E35', 500: '#3D3D46' },
        brand: { 50: '#FFF4EB', 100: '#FFE3CC', 200: '#FFC499', 300: '#FFA25C', 400: '#FF8A33', 500: '#FF7A1A', 600: '#E8620A', 700: '#B84B06', 800: '#7A3204', 900: '#3D1902' },
      },
      fontFamily: {
        sans: ['"IBM Plex Sans Arabic"', 'system-ui', 'sans-serif'],
        display: ['Cairo', '"IBM Plex Sans Arabic"', 'sans-serif'],
      },
      boxShadow: {
        glow: '0 0 0 1px rgba(255,122,26,.35), 0 8px 30px -8px rgba(255,122,26,.45)',
        card: '0 1px 0 0 rgba(255,255,255,.04) inset, 0 10px 30px -12px rgba(0,0,0,.6)',
      },
      keyframes: {
        rise: { from: { opacity: 0, transform: 'translateY(8px)' }, to: { opacity: 1, transform: 'none' } },
        pulseRing: { '0%': { boxShadow: '0 0 0 0 rgba(255,122,26,.5)' }, '100%': { boxShadow: '0 0 0 12px rgba(255,122,26,0)' } },
        shimmer: { from: { backgroundPosition: '200% 0' }, to: { backgroundPosition: '-200% 0' } },
      },
      animation: {
        rise: 'rise .35s cubic-bezier(.2,.8,.2,1) both',
        ring: 'pulseRing 1.6s ease-out infinite',
        shimmer: 'shimmer 2.2s linear infinite',
      },
    },
  },
  plugins: [],
}
