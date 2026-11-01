import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: './',
  plugins: [react()],
  server: { port: 5173, strictPort: true, fs: { allow: ['..'] } },
  optimizeDeps: { exclude: ['@electric-sql/pglite'] },
  build: { target: 'chrome128', outDir: 'dist', chunkSizeWarningLimit: 4000 },
})
