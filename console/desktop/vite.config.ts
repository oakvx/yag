import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  root: 'desktop',
  plugins: [react()],
  base: './',
  build: { outDir: 'dist', emptyOutDir: true },
  server: { port: 1420, strictPort: true, host: '127.0.0.1' },
  clearScreen: false,
})
