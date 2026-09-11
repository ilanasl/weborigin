// A curated list of free Google Fonts, plus dynamic loading helpers.
// The font picker lets the user switch any banner to one of these with a click.

export const GOOGLE_FONTS: string[] = [
  "Poppins",
  "Montserrat",
  "Inter",
  "Roboto",
  "Open Sans",
  "Lato",
  "Oswald",
  "Raleway",
  "Playfair Display",
  "Merriweather",
  "Nunito",
  "Work Sans",
  "Bebas Neue",
  "Archivo",
  "Rubik",
  "DM Sans",
  "Anton",
  "Teko",
  "Josefin Sans",
  "Quicksand",
];

const loaded = new Set<string>();

/** Inject a Google Fonts stylesheet for a family (multiple weights) once. */
export function loadFont(family: string): void {
  if (loaded.has(family)) return;
  loaded.add(family);
  const param = family.trim().replace(/\s+/g, "+");
  const href = `https://fonts.googleapis.com/css2?family=${param}:wght@300;400;500;600;700;800;900&display=swap`;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = href;
  document.head.appendChild(link);
}

/**
 * Ensure a font is actually available for rendering before we export a banner,
 * so the exported PNG uses the real font (not a fallback).
 */
export async function ensureFontReady(family: string): Promise<void> {
  loadFont(family);
  try {
    // Warm a few common weights.
    await Promise.all([
      (document as any).fonts.load(`400 16px "${family}"`),
      (document as any).fonts.load(`700 16px "${family}"`),
      (document as any).fonts.load(`900 16px "${family}"`),
    ]);
    await (document as any).fonts.ready;
  } catch {
    // document.fonts may be unavailable in some environments; ignore.
  }
}
