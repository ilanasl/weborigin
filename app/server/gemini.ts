import { GoogleGenAI } from "@google/genai";

const MODEL = process.env.GEMINI_IMAGE_MODEL || "gemini-2.5-flash-image";

let client: GoogleGenAI | null = null;

function getClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === "your_key_here") {
    throw new Error(
      "GEMINI_API_KEY is missing. Copy server/.env.example to server/.env and paste your key."
    );
  }
  if (!client) client = new GoogleGenAI({ apiKey });
  return client;
}

export type InputImage = { mimeType: string; data: string };

/** A single result image, returned as a data URL the browser can use directly. */
export type ImageResult = { dataUrl: string; mimeType: string };

/**
 * Generate or edit an image with Gemini.
 * - Text only  -> text-to-image (a fresh background / ad image).
 * - With images -> image editing / composition (e.g. place a supplied logo).
 */
export async function generateImage(
  prompt: string,
  inputImages: InputImage[] = []
): Promise<ImageResult> {
  const ai = getClient();

  const parts: any[] = [{ text: prompt }];
  for (const img of inputImages) {
    parts.push({ inlineData: { mimeType: img.mimeType, data: img.data } });
  }

  const response = await ai.models.generateContent({
    model: MODEL,
    contents: [{ role: "user", parts }],
  });

  const candidates = response.candidates ?? [];
  for (const candidate of candidates) {
    const outParts = candidate.content?.parts ?? [];
    for (const part of outParts) {
      const inline = (part as any).inlineData;
      if (inline?.data) {
        const mimeType = inline.mimeType || "image/png";
        return { dataUrl: `data:${mimeType};base64,${inline.data}`, mimeType };
      }
    }
  }

  // No image came back -> surface any text the model returned to help debugging.
  const text = response.text?.trim();
  throw new Error(
    text
      ? `The model returned text instead of an image: ${text}`
      : "The model did not return an image. Try rephrasing the prompt."
  );
}
