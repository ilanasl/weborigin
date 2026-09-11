// Client helpers that call the local server, which holds the Gemini key.

export type InputImage = { mimeType: string; data: string };

/** Split a data URL into { mimeType, data(base64) } for the API. */
export function dataUrlToInput(dataUrl: string): InputImage {
  const match = /^data:([^;]+);base64,(.*)$/.exec(dataUrl);
  if (!match) throw new Error("Unsupported image format (expected a data URL).");
  return { mimeType: match[1], data: match[2] };
}

async function postGenerate(
  prompt: string,
  images: InputImage[]
): Promise<string> {
  const res = await fetch("/api/generate-image", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, images }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error || `Request failed (${res.status})`);
  return json.dataUrl as string;
}

/** Text-to-image: generate a fresh background / ad image from a prompt. */
export function generateImage(prompt: string): Promise<string> {
  return postGenerate(prompt, []);
}

/**
 * Image editing: generate a scene and place supplied images into it
 * (e.g. put the user's logo on a shirt / box / truck).
 */
export function generateWithImages(
  prompt: string,
  dataUrls: string[]
): Promise<string> {
  return postGenerate(prompt, dataUrls.map(dataUrlToInput));
}

/** Is the server configured with an API key? */
export async function checkHealth(): Promise<{ ok: boolean; hasKey: boolean }> {
  try {
    const res = await fetch("/api/health");
    return await res.json();
  } catch {
    return { ok: false, hasKey: false };
  }
}
