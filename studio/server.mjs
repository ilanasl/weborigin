// Banner Studio — local server.
//
// What it does:
//   • serves studio.html at http://localhost:8787
//   • POST /api/generate-image  -> makes an AI background with Google Gemini
//   • POST /api/save            -> writes a finished banner into the output/ folder
//   • GET  /api/health          -> tells the page whether an API key is set
//
// Your Gemini key stays on THIS computer (in the .env file) and is never sent
// to the browser. Run it with:  npm install  then  npm start
import "dotenv/config";
import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GoogleGenAI } from "@google/genai";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8787);
const MODEL = process.env.GEMINI_IMAGE_MODEL || "gemini-2.5-flash-image";

const hasKey = () =>
  !!process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== "your_key_here";

function outputDir() {
  return process.env.OUTPUT_DIR
    ? path.resolve(process.env.OUTPUT_DIR)
    : path.resolve(HERE, "output");
}

// --- Gemini image generation ------------------------------------------------
let client = null;
async function generateImage(prompt, aspectRatio) {
  if (!hasKey()) {
    throw new Error(
      "No Gemini key yet. Copy .env.example to .env and paste your key, then restart."
    );
  }
  if (!client) client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

  const contents = [{ role: "user", parts: [{ text: prompt }] }];
  // Ask for the closest supported output shape (e.g. 21:9 for wide banners).
  // If this SDK/model build doesn't accept imageConfig, fall back to a plain call.
  let response, arFallback = null;
  try {
    if (aspectRatio) console.log(`  → requesting image at aspectRatio ${aspectRatio}`);
    response = await client.models.generateContent(
      aspectRatio
        ? { model: MODEL, contents, config: { imageConfig: { aspectRatio } } }
        : { model: MODEL, contents }
    );
  } catch (err) {
    if (!aspectRatio) throw err;
    arFallback = err?.message || String(err);
    console.warn(`  ⚠ aspectRatio '${aspectRatio}' was rejected: ${arFallback}\n     retrying without it (image will be square).`);
    response = await client.models.generateContent({ model: MODEL, contents });
  }

  for (const candidate of response.candidates ?? []) {
    for (const part of candidate.content?.parts ?? []) {
      const inline = part.inlineData;
      if (inline?.data) {
        const mimeType = inline.mimeType || "image/png";
        return { dataUrl: `data:${mimeType};base64,${inline.data}`, mimeType, arFallback };
      }
    }
  }
  const text = response.text?.trim();
  throw new Error(
    text
      ? `The model returned text instead of an image: ${text}`
      : "The model did not return an image. Try rephrasing the topic."
  );
}

// --- Server -----------------------------------------------------------------
const app = express();
app.use(express.json({ limit: "25mb" })); // banners with base64 images are large

app.get("/api/health", (_req, res) => res.json({ ok: true, hasKey: hasKey() }));

app.post("/api/generate-image", async (req, res) => {
  try {
    const prompt = String(req.body?.prompt || "").trim();
    if (!prompt) return res.status(400).json({ error: "Missing 'prompt'." });
    const aspectRatio = req.body?.aspectRatio ? String(req.body.aspectRatio) : undefined;
    res.json(await generateImage(prompt, aspectRatio));
  } catch (err) {
    console.error("generate-image failed:", err?.message || err);
    res.status(500).json({ error: err?.message || "Image generation failed." });
  }
});

app.post("/api/save", (req, res) => {
  try {
    const filename = String(req.body?.filename || "").replace(/[^\w.\-]+/g, "_");
    const m = /^data:[^;]+;base64,(.*)$/.exec(String(req.body?.dataUrl || ""));
    if (!filename || !m) {
      return res.status(400).json({ error: "Missing 'filename' or valid 'dataUrl'." });
    }
    const dir = outputDir();
    fs.mkdirSync(dir, { recursive: true });
    const full = path.join(dir, filename);
    fs.writeFileSync(full, Buffer.from(m[1], "base64"));
    res.json({ ok: true, path: full });
  } catch (err) {
    console.error("save failed:", err?.message || err);
    res.status(500).json({ error: err?.message || "Save failed." });
  }
});

app.get("/api/output-dir", (_req, res) => res.json({ dir: outputDir() }));

// Serve the studio page itself.
app.get("/", (_req, res) => res.sendFile(path.join(HERE, "studio.html")));
app.use(express.static(HERE));

app.listen(PORT, () => {
  console.log(`\n  🗂  Banner Studio is running.`);
  console.log(`  Open this in your browser:  http://localhost:${PORT}\n`);
  if (hasKey()) {
    console.log(`  ✓ AI is active (model: ${MODEL}).`);
    console.log(`  ✓ Generated banners save to: ${outputDir()}\n`);
  } else {
    console.log(
      `  ⚠  No Gemini key yet — you can still upload your own images.`
    );
    console.log(
      `     To turn on AI: copy .env.example to .env, paste your key, restart.\n`
    );
  }
});
