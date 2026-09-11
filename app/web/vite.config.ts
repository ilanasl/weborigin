import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const API_PORT = process.env.API_PORT || "8787";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Forward API calls to the local Express server so the browser never
    // sees the Gemini key and there are no CORS issues in dev.
    proxy: {
      "/api": `http://localhost:${API_PORT}`,
    },
  },
});
