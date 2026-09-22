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
const OPENAI_MODEL = process.env.OPENAI_IMAGE_MODEL || "gpt-image-1";
const OPENAI_QUALITY = process.env.OPENAI_IMAGE_QUALITY || "high";
// Tried in order until one is available on this project/API version.
const IMAGEN_MODELS = process.env.IMAGEN_MODEL
  ? [process.env.IMAGEN_MODEL]
  : [
      "imagen-4.0-generate-preview-06-06",
      "imagen-4.0-generate-001",
      "imagen-3.0-generate-002",
    ];
const IMAGEN_SIZE = process.env.IMAGEN_SIZE || "2K";
// Text models tried (in order) for the ad-image idea generator.
const IDEAS_MODELS = process.env.IDEAS_MODEL
  ? [process.env.IDEAS_MODEL]
  : ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-flash-latest", "gemini-2.5-flash-lite"];

const hasKey = () =>
  !!process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== "your_key_here";
const hasOpenAI = () =>
  !!process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY !== "your_key_here";

function outputDir() {
  return process.env.OUTPUT_DIR
    ? path.resolve(process.env.OUTPUT_DIR)
    : path.resolve(HERE, "output");
}
// Where saved-banner backups live (one JSON per banner). Set BACKUP_DIR in .env
// to any folder (e.g. an absolute path) — default is ./backups next to the app.
function backupDir() {
  return process.env.BACKUP_DIR
    ? path.resolve(process.env.BACKUP_DIR)
    : path.resolve(HERE, "backups");
}
const safeName = (s) => String(s || "").replace(/[^\w.\-]+/g, "_").slice(0, 120) || "banner";

// --- Gemini image generation ------------------------------------------------
let client = null;
async function generateImage(prompt, aspectRatio, model) {
  if (!hasKey()) {
    throw new Error(
      "No Gemini key yet. Copy .env.example to .env and paste your key, then restart."
    );
  }
  if (!client) client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const useModel = (model && String(model)) || MODEL;

  const contents = [{ role: "user", parts: [{ text: prompt }] }];
  // Ask for the closest supported output shape (e.g. 21:9 for wide banners).
  // If this SDK/model build doesn't accept imageConfig, fall back to a plain call.
  let response, arFallback = null;
  try {
    if (aspectRatio) console.log(`  → ${useModel} at aspectRatio ${aspectRatio}`);
    response = await client.models.generateContent(
      aspectRatio
        ? { model: useModel, contents, config: { imageConfig: { aspectRatio } } }
        : { model: useModel, contents }
    );
  } catch (err) {
    if (!aspectRatio) throw err;
    arFallback = err?.message || String(err);
    console.warn(`  ⚠ aspectRatio '${aspectRatio}' was rejected: ${arFallback}\n     retrying without it.`);
    response = await client.models.generateContent({ model: useModel, contents });
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

// --- OpenAI (gpt-image-1) image generation ----------------------------------
async function generateImageOpenAI(prompt, aspectRatio, quality, model) {
  if (!hasOpenAI()) {
    throw new Error(
      "No OpenAI key. Add OPENAI_API_KEY to .env and restart."
    );
  }
  const mdl = (model && /^gpt-image|^chatgpt-image/i.test(String(model))) ? String(model) : OPENAI_MODEL;
  const q = ["low", "medium", "high"].includes(String(quality)) ? String(quality) : OPENAI_QUALITY;
  // gpt-image-1 supports a small set of sizes; pick the closest to the banner.
  let size = "1536x1024";
  if (aspectRatio) {
    const [w, h] = String(aspectRatio).split(":").map(Number);
    if (w && h) {
      const r = w / h;
      size = r >= 1.2 ? "1536x1024" : r <= 0.8 ? "1024x1536" : "1024x1024";
    }
  }
  const resp = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({ model: mdl, prompt, size, quality: q, n: 1 }),
  });
  const j = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(j?.error?.message || `OpenAI HTTP ${resp.status}`);
  const b64 = j?.data?.[0]?.b64_json;
  if (!b64) throw new Error("OpenAI returned no image.");
  return { dataUrl: `data:image/png;base64,${b64}`, mimeType: "image/png" };
}

// --- Imagen 4 image generation (uses the same Gemini key) -------------------
function nearestImagenAspect(r) {
  const opts = [["16:9", 16 / 9], ["4:3", 4 / 3], ["1:1", 1], ["3:4", 3 / 4], ["9:16", 9 / 16]];
  let best = "16:9", bd = Infinity;
  for (const [l, v] of opts) { const d = Math.abs(v - r); if (d < bd) { bd = d; best = l; } }
  return best;
}
async function generateImageImagen(prompt, aspectRatio) {
  if (!hasKey()) throw new Error("No Gemini key — Imagen uses the same GEMINI_API_KEY.");
  if (!client) client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  let ar = "16:9";
  if (aspectRatio) {
    const [w, h] = String(aspectRatio).split(":").map(Number);
    if (w && h) ar = nearestImagenAspect(w / h);
  }
  const configs = [
    { numberOfImages: 1, aspectRatio: ar, imageSize: IMAGEN_SIZE },
    { numberOfImages: 1, aspectRatio: ar }, // some models/tiers reject imageSize
  ];
  let lastErr = null;
  for (const model of IMAGEN_MODELS) {
    for (const config of configs) {
      try {
        const resp = await client.models.generateImages({ model, prompt, config });
        const b64 = resp?.generatedImages?.[0]?.image?.imageBytes;
        if (b64) {
          console.log(`  ✓ Imagen used model ${model}`);
          return { dataUrl: `data:image/png;base64,${b64}`, mimeType: "image/png" };
        }
        lastErr = new Error("Imagen returned no image (possibly filtered by safety).");
      } catch (err) {
        lastErr = err;
        const msg = String(err?.message || err);
        // Only move on for "model/arg not available" errors; surface real failures.
        if (!/not found|not_found|404|imageSize|INVALID_ARGUMENT|is not supported/i.test(msg)) throw err;
      }
    }
  }
  throw new Error(
    "Imagen isn't available on your project yet: " + (lastErr?.message || "no model matched") +
    ". Try again, or use the GPT / Gemini engine."
  );
}

// --- Domain marketing briefs ------------------------------------------------
// Tailor the idea generator to a marketing vertical so the SUGGESTED prompts
// read like a performance marketer wrote them — not generic stock ideas.
// Each brief: match (regex on the topic), plus a marketer persona + the visual
// themes that convert for that vertical + hard "never show" guardrails.
const DOMAIN_BRIEFS = [
  {
    id: "weightloss",
    match: /weight[\s-]?loss|weight[\s-]?management|slim|diet|glp[\s-]?1|semaglutide|ozempic|wegovy|obesity|fat[\s-]?loss|הרזי|רזי|משקל|דיאט/i,
    brief:
      "You are a senior performance marketer for a weight-loss / GLP-1 medication " +
      "comparison brand (think TrimRx, Ro, Noom, Hers, MEDVi). These banners sit above a " +
      "'best weight-loss providers' comparison table and must feel aspirational, warm, clinical-clean " +
      "and trustworthy — the promise is an easier, healthier body, not a hard sell. " +
      "The primary audience is women, so lead with real, relatable women (diverse in age 30s–60s and in ethnicity), radiating quiet confidence and everyday joy — but for variety you MAY also include some men, couples, or friends together in roughly 15% of the concepts (about one in seven — clearly a minority; the rest are women). " +
      "Draw from a WIDE pool of on-brand scenes and mix them up — do not lean on the same few every time. Examples: preparing or enjoying colorful healthy food (salad, fruit, smoothie, lean protein, a balanced plate, meal-prep containers, a glass of water); cooking together in a bright kitchen; grocery or farmers-market shopping for fresh produce; a relaxed walk, light jog, hike, bike ride, morning stretch or yoga; dancing or playing actively with kids or grandkids; gardening; trying on clothes that now fit better or holding out a loose waistband to hint at progress WITHOUT any before/after split; measuring the waist with a soft tape; checking a health or step app on a phone; a calm telehealth video chat with a doctor on a laptop; journaling or planning meals; laughing with friends over a healthy brunch; feeling good and comfortable at home, at the beach, or getting dressed for a night out. " +
      "Warm, bright, natural light, clean modern homes and kitchens, parks and cafes, soft neutral palettes. " +
      "These are clean standalone ad images — the woman or subject should fill the frame naturally; do NOT compose for a headline or leave large empty background areas for text. " +
      "Ad-policy critical: this is medical/health advertising, so NEVER show needles, syringes, injection pens, injecting, vials, pills close-up, scales with numbers, a woman pinching or grabbing fat, distressed or shamed expressions, or literal before/after comparison panels. No dramatic transformation claims — keep it gentle, healthy and lifestyle-led.",
  },
];
function domainBriefFor(topic, description) {
  const hay = `${topic} ${description || ""}`;
  return (DOMAIN_BRIEFS.find((d) => d.match.test(hay)) || {}).brief || "";
}

// --- Ad-image idea generator (text) -----------------------------------------
async function generateIdeas(topic, negative, description, count) {
  if (!hasKey()) throw new Error("No Gemini key — the idea generator uses GEMINI_API_KEY.");
  if (!client) client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const brief = domainBriefFor(topic, description);
  // Nudge each run toward a different corner of the idea space so repeated
  // clicks give a genuinely fresh, varied set (not the same 5 every time).
  const ANGLES = [
    "food & cooking", "outdoor activity & movement", "everyday confidence at home",
    "shopping for fresh food", "social moments with friends or family",
    "getting dressed / clothes fitting better", "self-care & healthy routines",
    "being active with kids or a partner",
  ];
  const shuffled = ANGLES.map((a) => [Math.random(), a]).sort((x, y) => x[0] - y[0]).map((p) => p[1]);
  const nonce = Math.random().toString(36).slice(2, 8);
  const prompt =
    (brief ? brief + "\n\n" : "") +
    `I am creating stock advertising photographs for the topic: "${topic}".` +
    (description ? ` Extra direction: ${description}.` : "") +
    (negative ? ` On top of any rule above, the images must NOT contain: ${negative}.` : "") +
    `\nGive me ${count} distinct, concrete photo concepts` +
    (brief ? ` that a smart marketer in this vertical would actually run` : "") +
    `. Each concept is ONE short English sentence describing a single realistic photograph (subject, setting, mood).` +
    ` IMPORTANT — maximize VARIETY: every concept must be a clearly different scene, setting, activity, and person` +
    (brief ? ` (vary age, ethnicity, and gender across the set)` : ``) +
    `. Do NOT repeat the same few ideas you would normally give; surprise me with fresh but on-brand concepts.` +
    (brief ? ` For this batch especially, spread the concepts across these different angles: ${shuffled.slice(0, Math.min(count, shuffled.length)).join("; ")}.` : ``) +
    ` Every concept must respect every "never show" / "must NOT contain" rule above.` +
    ` No numbering and no extra commentary.` +
    ` Return ONLY a JSON array of exactly ${count} strings. (variety token ${nonce})`;
  let lastErr = null;
  for (const model of IDEAS_MODELS) {
    try {
      const resp = await client.models.generateContent({
        model,
        config: { temperature: 1.15 },
        contents: [{ role: "user", parts: [{ text: prompt }] }],
      });
      const text = (resp.text || "").trim();
      let ideas = [];
      try {
        const m = text.match(/\[[\s\S]*\]/);
        ideas = JSON.parse(m ? m[0] : text);
      } catch (_) {
        ideas = text.split(/\n+/).map((s) => s.replace(/^[-*\d.\)\s]+/, "").trim()).filter(Boolean);
      }
      ideas = ideas.filter((s) => typeof s === "string" && s.trim()).slice(0, count);
      if (ideas.length) { console.log(`  ✓ ideas via ${model}`); return ideas; }
    } catch (err) {
      lastErr = err;
      const msg = String(err?.message || err);
      if (!/not found|not_found|404|is not supported/i.test(msg)) throw err;
    }
  }
  throw new Error("Could not generate ideas: " + (lastErr?.message || "no text model available"));
}

// --- Server -----------------------------------------------------------------
const app = express();
app.use(express.json({ limit: "25mb" })); // banners with base64 images are large

app.get("/api/health", (_req, res) =>
  res.json({ ok: true, hasKey: hasKey(), hasOpenAI: hasOpenAI() })
);

// Diagnostic: which models does this OpenAI key actually have? (image ones highlighted)
app.get("/api/openai-models", async (_req, res) => {
  try {
    if (!hasOpenAI()) return res.status(400).json({ error: "No OpenAI key in .env." });
    const r = await fetch("https://api.openai.com/v1/models", {
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    });
    const j = await r.json();
    if (!r.ok) return res.status(r.status).json({ error: j?.error?.message || `HTTP ${r.status}` });
    const all = (j.data || []).map((m) => m.id).sort();
    const image = all.filter((id) => /image|dall/i.test(id));
    console.log("\n  OpenAI image models on your key:\n   " +
      (image.join("\n   ") || "(none found)") + "\n");
    res.json({ imageModels: image, totalModels: all.length, allModels: all });
  } catch (e) {
    res.status(500).json({ error: e?.message || String(e) });
  }
});

// Diagnostic: which image-capable models does this Gemini key actually have?
app.get("/api/models", async (_req, res) => {
  try {
    if (!hasKey()) return res.status(400).json({ error: "No Gemini key." });
    if (!client) client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const all = [];
    const pager = await client.models.list();
    for await (const m of pager) all.push({ name: m.name, actions: m.supportedActions || [] });
    const image = all.filter((m) => /imagen|image/i.test(m.name));
    console.log("\n  Image-capable models on your key:\n   " +
      (image.map((m) => m.name).join("\n   ") || "(none found)") + "\n");
    res.json({ imageModels: image, totalModels: all.length });
  } catch (e) {
    res.status(500).json({ error: e?.message || String(e) });
  }
});

app.post("/api/generate-image", async (req, res) => {
  try {
    const prompt = String(req.body?.prompt || "").trim();
    if (!prompt) return res.status(400).json({ error: "Missing 'prompt'." });
    const aspectRatio = req.body?.aspectRatio ? String(req.body.aspectRatio) : undefined;
    const provider = String(req.body?.provider || "gemini");
    res.json(
      provider === "openai"
        ? await generateImageOpenAI(prompt, aspectRatio, req.body?.quality, req.body?.model)
        : provider === "imagen"
        ? await generateImageImagen(prompt, aspectRatio)
        : await generateImage(prompt, aspectRatio, req.body?.model)
    );
  } catch (err) {
    console.error("generate-image failed:", err?.message || err);
    res.status(500).json({ error: err?.message || "Image generation failed." });
  }
});

// POST /api/ideas  { topic, negative?, description?, count? } -> { ideas: string[] }
app.post("/api/ideas", async (req, res) => {
  try {
    const topic = String(req.body?.topic || "").trim();
    if (!topic) return res.status(400).json({ error: "Missing 'topic'." });
    const negative = String(req.body?.negative || "").trim();
    const description = String(req.body?.description || "").trim();
    const count = Math.min(30, Math.max(1, parseInt(req.body?.count, 10) || 8));
    res.json({ ideas: await generateIdeas(topic, negative, description, count) });
  } catch (err) {
    console.error("ideas failed:", err?.message || err);
    res.status(500).json({ error: err?.message || "Idea generation failed." });
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

// --- Saved-banner backups (auto-written to a folder on this computer) --------
app.post("/api/bank/put", (req, res) => {
  try {
    const rec = req.body?.rec;
    if (!rec || !rec.id) return res.status(400).json({ error: "Missing 'rec' with an id." });
    const dir = backupDir();
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, safeName(rec.id) + ".json"), JSON.stringify(rec));
    res.json({ ok: true, dir });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Backup save failed." });
  }
});
app.post("/api/bank/del", (req, res) => {
  try {
    const id = req.body?.id;
    if (id) { try { fs.unlinkSync(path.join(backupDir(), safeName(id) + ".json")); } catch (_) {} }
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err?.message || "Backup delete failed." }); }
});
app.get("/api/bank/all", (_req, res) => {
  try {
    const dir = backupDir();
    if (!fs.existsSync(dir)) return res.json({ dir, records: [] });
    const records = [];
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith(".json")) continue;
      try { records.push(JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"))); } catch (_) {}
    }
    res.json({ dir, records });
  } catch (err) { res.status(500).json({ error: err?.message || "Backup read failed." }); }
});

// Serve the studio page itself.
app.get("/", (_req, res) => res.sendFile(path.join(HERE, "studio.html")));
app.use(express.static(HERE));

app.listen(PORT, () => {
  console.log(`\n  🗂  Banner Studio is running.`);
  console.log(`  Open this in your browser:  http://localhost:${PORT}\n`);
  if (hasKey()) console.log(`  ✓ Gemini active (model: ${MODEL}).`);
  if (hasOpenAI()) console.log(`  ✓ GPT active (model: ${OPENAI_MODEL}, quality: ${OPENAI_QUALITY}).`);
  console.log(`  💾 Saved-banner backups: ${backupDir()}`);
  if (hasKey() || hasOpenAI()) {
    console.log(`  ✓ Generated banners save to: ${outputDir()}\n`);
  } else {
    console.log(`  ⚠  No AI key yet — you can still upload your own images.`);
    console.log(`     To turn on AI: copy .env.example to .env, paste a key, restart.\n`);
  }
});
