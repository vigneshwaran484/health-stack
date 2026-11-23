import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      // The AI layer lives behind this thin server function so the API key
      // never reaches the browser. Swap the provider in server/ai.js.
      '/api': 'http://localhost:8787',
    },
  },
})
