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
import dotenv from "dotenv";
// The key in studio/.env always wins over a GEMINI_API_KEY / OPENAI_API_KEY set in Windows,
// so this app can use its own key while other tools keep theirs.
dotenv.config({ override: true });
import express from "express";
import Anthropic from "@anthropic-ai/sdk";
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
const hasClaude = () =>
  !!process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_API_KEY !== "your_key_here";
// Claude reads task cards, writes the image prompts and checks the finished banners (text + vision only).
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || "claude-opus-5-5";

function outputDir() {
  return process.env.OUTPUT_DIR
    ? path.resolve(process.env.OUTPUT_DIR)
    : path.resolve(HERE, "output");
}
// Where the New-task banners go for checking (QA_DIR in .env, e.g. C:\SPOTOWER\QA) — default output/QA.
function qaDir() {
  return process.env.QA_DIR ? path.resolve(process.env.QA_DIR) : path.join(outputDir(), "QA");
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
async function generateImageOpenAI(prompt, aspectRatio, quality, model, transparent) {
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
    body: JSON.stringify(
      transparent
        ? { model: mdl, prompt, size, quality: q, n: 1, background: "transparent", output_format: "png" }
        : { model: mdl, prompt, size, quality: q, n: 1 }
    ),
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
    angles: [
      "food & cooking", "outdoor activity & movement", "everyday confidence at home",
      "shopping for fresh food", "social moments with friends or family",
      "getting dressed / clothes fitting better", "self-care & healthy routines",
      "being active with kids or a partner",
    ],
  },
  {
    id: "online-education",
    match: /online\s*(college|degree|course|class|classes|learning|education|school|university|program|study|studying)|e-?learning|distance learning|students?\b|college|university|degree|לימוד|סטודנט|תואר|מכלל/i,
    brief:
      "You are a senior performance marketer for an online colleges / online degree comparison brand. " +
      "The audience is mostly working adults aged about 22–55 (career changers, parents, people studying alongside a job) plus some younger students. " +
      "The images must make online study feel achievable, flexible and rewarding: a real, relatable person clearly STUDYING ONLINE (laptop, tablet or headphones, notes), looking focused, calm or quietly pleased. " +
      "Use COMMON, believable places where people really study: different rooms at home (kitchen table, sofa, bedroom desk, home office, window seat, balcony), a library, a campus lawn or lounge, a quiet café table, a co-working space, a park bench, a commute on a train. " +
      "Mix single students, pairs studying together, and small groups (2–4) or a group video call — say exactly how many people. Vary age, gender and ethnicity ACROSS the set. A few concepts may show the payoff: graduation, a proud moment at the laptop, a confident new professional. " +
      "Never show: readable screens or text, school names or logos, crowded classrooms or lecture halls, children studying (a parent studying with a child nearby is fine), unrealistic or gimmicky situations.",
    angles: [
      "studying alone at home", "studying outdoors", "a pair or small group studying together",
      "a group video call / live online class", "a library or campus setting",
      "balancing study with work or family", "the payoff: graduation or career success", "evening or late-night study",
    ],
  },
];
function domainFor(topic, description) {
  const hay = `${topic} ${description || ""}`;
  return DOMAIN_BRIEFS.find((d) => d.match.test(hay)) || null;
}
function domainBriefFor(topic, description) {
  return (domainFor(topic, description) || {}).brief || "";
}
// Applies to EVERY topic: think like an experienced ad creative, not a "surprise me" generator.
const CREATIVE_BASE =
  "You write photo concepts for paid ads (Google / Meta) the way an experienced advertising creative director does. " +
  "Each concept is a REALISTIC, relatable moment the advertiser's real customer would recognise themselves in — common everyday places and situations, never odd, quirky, gimmicky or staged-looking. " +
  "The core action of the topic must read instantly, even as a small thumbnail. " +
  "Write each concept as: who (age, gender) + how many people (say 'alone' for one person, or the exact number) + what they are doing + where (a specific, believable setting) + one telling detail + the light / time of day. " +
  "Across the set, vary the setting, time of day, light, colour mood, camera distance, and the people's age, gender and ethnicity — but each single image shows only the people it names, with no extra background people. " +
  "Positive, warm, authentic mood; uncluttered scenes; no readable text, screens, logos or brand names.";
const GENERIC_ANGLES = [
  "at home", "outdoors", "with family or friends", "at work or in a public place",
  "a quiet personal moment", "the happy outcome / payoff", "morning light", "evening light",
];

// --- Ad-image idea generator (text) -----------------------------------------
async function generateIdeas(topic, negative, description, count) {
  if (!hasKey()) throw new Error("No Gemini key — the idea generator uses GEMINI_API_KEY.");
  if (!client) client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const dom = domainFor(topic, description);
  const brief = (dom && dom.brief) || "";
  // Nudge each run toward a different corner of the idea space so repeated
  // clicks give a genuinely fresh, varied set (not the same 5 every time).
  const ANGLES = (dom && dom.angles) || GENERIC_ANGLES;
  const shuffled = ANGLES.map((a) => [Math.random(), a]).sort((x, y) => x[0] - y[0]).map((p) => p[1]);
  const nonce = Math.random().toString(36).slice(2, 8);
  const prompt =
    CREATIVE_BASE + "\n\n" +
    (brief ? brief + "\n\n" : "") +
    `I am creating stock advertising photographs for the topic: "${topic}".` +
    (description ? ` Extra direction: ${description}.` : "") +
    (negative ? ` On top of any rule above, the images must NOT contain: ${negative}.` : "") +
    `\nGive me ${count} distinct, concrete photo concepts` +
    (brief ? ` that a smart marketer in this vertical would actually run` : "") +
    `. Each concept is ONE short English sentence describing a single realistic photograph (subject, setting, mood).` +
    ` IMPORTANT — maximize VARIETY: every concept must be a clearly different scene, setting, activity, and person` +
    (brief ? ` (vary age, ethnicity, and gender across the set)` : ``) +
    `. Do NOT repeat the same few ideas you would normally give — fresh, but always realistic and on-brand (never odd or gimmicky).` +
    ` For this batch especially, spread the concepts across these different angles: ${shuffled.slice(0, Math.min(count, shuffled.length)).join("; ")}.` +
    ` Every concept must respect every "never show" / "must NOT contain" rule above.` +
    ` No numbering and no extra commentary.` +
    ` Return ONLY a JSON array of exactly ${count} strings. (variety token ${nonce})`;
  let lastErr = null;
  for (const model of IDEAS_MODELS) {
    try {
      const resp = await client.models.generateContent({
        model,
        config: { temperature: 0.9 },
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

// --- Claude: task brief + banner review --------------------------------------
let anthropic = null;
let claudeFallbacks = true; // turned off for the session once the account turns the option down
// One JSON answer from Claude, shaped by `schema`. Refusals fall back to another model on the server side.
async function askClaude({ system, content, schema, effort }) {
  if (!hasClaude()) throw new Error("No Claude key — add ANTHROPIC_API_KEY to .env and restart.");
  if (!anthropic) anthropic = new Anthropic();
  const params = {
    model: CLAUDE_MODEL,
    max_tokens: 16000,
    system,
    messages: [{ role: "user", content }],
    output_config: { effort, format: { type: "json_schema", schema } },
  };
  let resp;
  if (claudeFallbacks) {
    try {
      resp = await anthropic.beta.messages.create({ ...params, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" });
    } catch (err) {
      // An account that can't use the fallback option yet: same request without it.
      if (!(err instanceof Anthropic.BadRequestError)) throw err;
      resp = await anthropic.messages.create(params);
      claudeFallbacks = false;
    }
  } else resp = await anthropic.messages.create(params);
  if (resp.stop_reason === "refusal") throw new Error("Claude declined this request.");
  if (resp.stop_reason === "max_tokens") throw new Error("Claude's answer was cut off — try a shorter card.");
  const text = resp.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  return JSON.parse(text);
}
// data:image/...;base64,... -> a Claude image block
function imageBlock(dataUrl) {
  const m = /^data:(image\/(?:png|jpeg|webp|gif));base64,(.*)$/.exec(String(dataUrl || ""));
  return m ? { type: "image", source: { type: "base64", media_type: m[1], data: m[2] } } : null;
}

const BRIEF_SYSTEM = [
  "You are the art director of a small banner studio. A client's task card arrives (pasted text, sometimes with attached images such as the current banner). Turn it into a ready-to-run brief for the studio's banner templates.",
  "1. Pick the template whose desktop / mobile pixel sizes match the card. Sizes decide; the name is only a hint. If no template matches the sizes, set template_id to \"none\" and say why in template_reason.",
  "2. texts: fill only the text_fields keys of the chosen template, using the client's exact wording (keep their spelling, punctuation and capitalisation). Split a long promotion line across the template's lines the way a designer would (for example the highlighted phrase in the highlight line). Leave a key out when the card has nothing for it. When the template's text_on_image is false the site writes its own text over the image, so return an empty texts list.",
  "3. versions: as many as the card asks for (default 2). Each version is a different marketing idea, not a small variation — for example one with a person and one without, or two different messages taken from the client's page (savings, trust, speed, several pets...). Say in why which message it carries.",
  "4. topic: the image prompt for that version, in English. Describe only the picture — who or what, doing what, where, the light, the mood. The template adds the layout, crop and background rules itself, so never mention banner sizes, text space, sides or crops, and never ask for text, logos or UI words in the image.",
  "House style for topics: real-looking people with natural skin and a natural smile, shown close enough that faces stay large (chest or waist up, hands visible when they hold something); believable everyday settings; bright, airy, soft daylight; no kitsch, no clutter, no stock-photo poses; screens show a believable app, chart or dashboard, softly blurred so no words are readable. When the template is a transparent cut-out, describe one isolated subject with no background or scene. Follow the style of the template's example_topics.",
  "Framing: one person (two at most) with the pet or object, shown close — chest or waist up, faces large, the group compact — so it still reads in a narrow photo strip and on mobile. No wide room shots, no groups or crowds, no small figures in a big space. Leave a little space above the heads.",
  "If an attached image shows the client's current banner, keep its structure and mood and match its colour world, but bring new ideas.",
  "style_name: when the chosen template lists saved_styles, pick the one whose name matches the client's site or domain (exact name from the list); otherwise an empty string.",
  "5. job_name: 2 to 5 words for a folder name (e.g. Pet Insurance Main Banner). notes: anything the designer must do by hand (a logo to upload, a colour to set, a request the templates cannot do), or an empty string.",
].join("\n");
const BRIEF_SCHEMA = {
  type: "object", additionalProperties: false,
  required: ["template_id", "template_reason", "style_name", "job_name", "texts", "versions", "notes"],
  properties: {
    template_id: { type: "string" },
    template_reason: { type: "string" },
    style_name: { type: "string" },
    job_name: { type: "string" },
    texts: { type: "array", items: { type: "object", additionalProperties: false, required: ["key", "value"],
      properties: { key: { type: "string" }, value: { type: "string" } } } },
    versions: { type: "array", items: { type: "object", additionalProperties: false, required: ["title", "why", "topic"],
      properties: { title: { type: "string" }, why: { type: "string" }, topic: { type: "string" } } } },
    notes: { type: "string" },
  },
};
const REVIEW_SYSTEM = [
  "You check finished web banners before they go to the client. You get the desktop and mobile renders of one banner plus its brief.",
  "Pass it (ok = true) unless something would embarrass the studio: a cropped head or face, a head touching the top edge, people or pets so small in the photo that faces are hard to see (they should fill most of the photo's height), more than three people crowding the picture, a visible hard edge or colour jump where the plain colour area meets the photo, a person cut by the frame edge in an ugly place, deformed hands, faces or bodies, a stray wall, door frame or object at the photo's edge that looks like a mistake, two photos visibly stitched together, readable gibberish text or fake logos inside the image, the image covering the text, or text that is hard to read.",
  "Small taste differences are not problems. Judge only what you can see.",
  "problems: short plain sentences, empty when ok. prompt_fix: one short English sentence to add to the image prompt so the next try avoids the problems (empty when ok).",
].join("\n");
const REVIEW_SCHEMA = {
  type: "object", additionalProperties: false,
  required: ["ok", "problems", "prompt_fix"],
  properties: { ok: { type: "boolean" }, problems: { type: "array", items: { type: "string" } }, prompt_fix: { type: "string" } },
};

// --- Server -----------------------------------------------------------------
const app = express();
app.use(express.json({ limit: "25mb" })); // banners with base64 images are large

app.get("/api/health", (_req, res) =>
  res.json({ ok: true, hasKey: hasKey(), hasOpenAI: hasOpenAI(), hasClaude: hasClaude() })
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
        ? await generateImageOpenAI(prompt, aspectRatio, req.body?.quality, req.body?.model, req.body?.transparent)
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

// POST /api/brief  { card, images?: [dataUrl], templates: [...] } -> brief (see BRIEF_SCHEMA)
app.post("/api/brief", async (req, res) => {
  try {
    const card = String(req.body?.card || "").trim();
    if (!card) return res.status(400).json({ error: "Paste the task card first." });
    const templates = Array.isArray(req.body?.templates) ? req.body.templates : [];
    const images = (req.body?.images || []).map(imageBlock).filter(Boolean).slice(0, 6);
    const content = [
      ...images,
      { type: "text", text: "Templates available:\n" + JSON.stringify(templates, null, 1) + "\n\nTask card:\n" + card },
    ];
    const brief = await askClaude({ system: BRIEF_SYSTEM, content, schema: BRIEF_SCHEMA, effort: "medium" });
    console.log(`  ✓ brief: ${brief.template_id} — ${brief.job_name}`);
    res.json(brief);
  } catch (err) {
    console.error("brief failed:", err?.message || err);
    res.status(500).json({ error: err?.message || "Brief failed." });
  }
});

// POST /api/review  { images: [{label, dataUrl}], brief } -> { ok, problems, prompt_fix }
app.post("/api/review", async (req, res) => {
  try {
    const content = [];
    for (const im of req.body?.images || []) {
      const b = imageBlock(im?.dataUrl);
      if (b) content.push({ type: "text", text: String(im.label || "Banner") + ":" }, b);
    }
    if (!content.length) return res.status(400).json({ error: "No banner images to review." });
    content.push({ type: "text", text: "Brief:\n" + JSON.stringify(req.body?.brief || {}, null, 1) });
    res.json(await askClaude({ system: REVIEW_SYSTEM, content, schema: REVIEW_SCHEMA, effort: "low" }));
  } catch (err) {
    console.error("review failed:", err?.message || err);
    res.status(500).json({ error: err?.message || "Review failed." });
  }
});

app.post("/api/save", (req, res) => {
  try {
    const filename = String(req.body?.filename || "").replace(/[^\w.\-]+/g, "_");
    const m = /^data:[^;]+;base64,(.*)$/.exec(String(req.body?.dataUrl || ""));
    const text = typeof req.body?.text === "string" ? req.body.text : null;
    if (!filename || (!m && text === null)) {
      return res.status(400).json({ error: "Missing 'filename' or valid 'dataUrl'." });
    }
    // Optional subfolder inside the output folder, e.g. "QA/1022 Pet Insurance" (each part cleaned; no "..").
    const parts = String(req.body?.folder || "").split(/[\\/]+/).map((p) => p.replace(/[^\w .\-]+/g, "_").replace(/^[.\s]+|[.\s]+$/g, "")).filter(Boolean);
    // A folder starting with "QA" goes to the QA folder (QA_DIR), everything else under the output folder.
    const dir = parts[0] === "QA" ? path.join(qaDir(), ...parts.slice(1)) : path.join(outputDir(), ...parts);
    fs.mkdirSync(dir, { recursive: true });
    const full = path.join(dir, filename);
    if (m) fs.writeFileSync(full, Buffer.from(m[1], "base64"));
    else fs.writeFileSync(full, text, "utf8");
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
  if (hasKey()) console.log(`  ✓ Gemini active (model: ${MODEL}) — key …${String(process.env.GEMINI_API_KEY).slice(-4)}.`);
  if (hasClaude()) console.log(`  ✓ Claude active for task cards (model: ${CLAUDE_MODEL}) — key …${String(process.env.ANTHROPIC_API_KEY).slice(-4)}.`);
  if (hasOpenAI()) console.log(`  ✓ GPT active (model: ${OPENAI_MODEL}, quality: ${OPENAI_QUALITY}) — key …${String(process.env.OPENAI_API_KEY).slice(-4)}.`);
  console.log(`  💾 Saved-banner backups: ${backupDir()}`);
  if (hasKey() || hasOpenAI()) {
    console.log(`  ✓ Generated banners save to: ${outputDir()}`);
    if (hasClaude()) console.log(`  ✓ New-task banners (for checking) save to: ${qaDir()}`);
    console.log("");
  } else {
    console.log(`  ⚠  No AI key yet — you can still upload your own images.`);
    console.log(`     To turn on AI: copy .env.example to .env, paste a key, restart.\n`);
  }
});
