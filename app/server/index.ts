import "dotenv/config";
import express from "express";
import cors from "cors";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import { generateImage, type InputImage } from "./gemini.js";

const app = express();
const PORT = Number(process.env.PORT || 8787);

app.use(cors());
// Banners with base64 images can be large; allow a generous body size.
app.use(express.json({ limit: "25mb" }));

app.get("/api/health", (_req, res) => {
  const hasKey =
    !!process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== "your_key_here";
  res.json({ ok: true, hasKey });
});

/**
 * POST /api/generate-image
 * body: { prompt: string, images?: { mimeType, data }[] }
 * Text-to-image, or image editing when `images` is provided (e.g. logo placement).
 */
app.post("/api/generate-image", async (req, res) => {
  try {
    const prompt = String(req.body?.prompt || "").trim();
    if (!prompt) return res.status(400).json({ error: "Missing 'prompt'." });
    const images: InputImage[] = Array.isArray(req.body?.images)
      ? req.body.images
      : [];
    const result = await generateImage(prompt, images);
    res.json(result);
  } catch (err: any) {
    console.error("generate-image failed:", err?.message || err);
    res.status(500).json({ error: err?.message || "Image generation failed." });
  }
});

// In production (`npm run build` then `npm start`) serve the built web app too.
const distDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../web/dist"
);
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get("*", (_req, res) => res.sendFile(path.join(distDir, "index.html")));
}

app.listen(PORT, () => {
  console.log(`\n  Banner platform API running at http://localhost:${PORT}`);
  const hasKey =
    !!process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== "your_key_here";
  if (!hasKey) {
    console.log(
      "  ⚠  No GEMINI_API_KEY yet. Copy server/.env.example to server/.env to enable AI images.\n"
    );
  }
});
