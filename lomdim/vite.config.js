import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// לומדים ביחד — Vite config
// אפליקציית SPA שנפרסת חינם (Vercel / Netlify / Cloudflare Pages).
export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
})
