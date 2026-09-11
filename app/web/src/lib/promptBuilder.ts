// Builds a clean prompt for the AI from structured inputs.

export type AdImageInputs = {
  subject: string; // e.g. "a moving company: movers carrying boxes"
  include?: string; // things that MUST appear
  avoid?: string; // things to keep OUT (e.g. no text on boxes)
  style?: string; // e.g. "photorealistic, warm light"
  aspect?: string; // e.g. "16:9"
  hasLogo?: boolean;
  logoPlacement?: string; // e.g. "on the movers' shirts"
};

/** Prompt for a pure ad image (no text overlay baked in). */
export function buildAdPrompt(i: AdImageInputs): string {
  const lines: string[] = [];
  lines.push(i.subject.trim());
  if (i.style?.trim()) lines.push(`Style: ${i.style.trim()}.`);
  if (i.include?.trim()) lines.push(`Must include: ${i.include.trim()}.`);
  if (i.aspect?.trim()) lines.push(`Aspect ratio ${i.aspect.trim()}.`);

  // Negative guidance. Gemini has no separate negative field, so we phrase it.
  const avoids: string[] = [];
  if (i.avoid?.trim()) avoids.push(i.avoid.trim());
  // Ad images should be clean of accidental text unless asked otherwise.
  avoids.push("no watermarks, no captions, no gibberish text unless requested");
  lines.push(`Avoid: ${avoids.join("; ")}.`);

  if (i.hasLogo) {
    lines.push(
      `Use the provided logo image and place it naturally ${
        i.logoPlacement?.trim() || "on a visible surface in the scene"
      }, matching perspective, lighting and material. Keep the logo undistorted and legible.`
    );
  }
  return lines.join("\n");
}

/** Prompt for a banner background (atmosphere only, room left for text). */
export function buildBackgroundPrompt(topic: string, aspect?: string): string {
  const lines = [
    topic.trim() || "clean abstract background",
    "Background image for a web banner: leave calm, uncluttered areas for text overlay.",
    "Avoid: any text, letters, words or watermarks in the image.",
  ];
  if (aspect?.trim()) lines.push(`Aspect ratio ${aspect.trim()}.`);
  return lines.join("\n");
}

/** Turn width/height into the nearest simple aspect string for the prompt. */
export function aspectFromSize(w: number, h: number): string {
  const r = w / h;
  const table: [string, number][] = [
    ["1:1", 1],
    ["4:3", 4 / 3],
    ["3:2", 3 / 2],
    ["16:9", 16 / 9],
    ["3:1", 3],
    ["2:3", 2 / 3],
    ["9:16", 9 / 16],
  ];
  let best = table[0];
  for (const t of table) {
    if (Math.abs(t[1] - r) < Math.abs(best[1] - r)) best = t;
  }
  return best[0];
}
