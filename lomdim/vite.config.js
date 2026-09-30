import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// לומדים ביחד — Vite config
// אפליקציית SPA שנפרסת חינם (Vercel / Netlify / Cloudflare Pages).
export default defineConfig({
  plugins: [react()],
  // מזהה הגרסה (commit ב-Vercel) — מוצג בתחתית ההגדרות, כדי לדעת איזו גרסה רצה בטלפון
  define: { __APP_VERSION__: JSON.stringify((process.env.VERCEL_GIT_COMMIT_SHA || 'local').slice(0, 7)) },
  server: { port: 5173 },
})
