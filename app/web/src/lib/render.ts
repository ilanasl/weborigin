import {
  type Template,
  type SizeKey,
  type Overlay,
  resolveElement,
} from "../templates/schema";

// Pure-canvas renderer — the single source of truth for how a banner looks.
// Used for gallery thumbnails, the live preview, and batch export, so every
// surface matches exactly and there is no web-font embedding to worry about.

export type RenderInput = {
  template: Template;
  size: SizeKey;
  image: HTMLImageElement | null;
  texts: Record<string, string>;
  showText: boolean;
};

function hexA(hex: string, a: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.replace("#", ""));
  if (!m) return `rgba(0,0,0,${a})`;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

function horiz(pos: string | undefined): "left" | "center" | "right" {
  if (!pos) return "center";
  if (pos.includes("left")) return "left";
  if (pos.includes("right")) return "right";
  return "center";
}

function drawCover(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  W: number,
  H: number,
  pos: string | undefined
) {
  const s = Math.max(W / img.naturalWidth, H / img.naturalHeight);
  const dw = img.naturalWidth * s;
  const dh = img.naturalHeight * s;
  const h = horiz(pos);
  const dx = h === "left" ? 0 : h === "right" ? W - dw : (W - dw) / 2;
  const dy = (H - dh) / 2;
  ctx.drawImage(img, dx, dy, dw, dh);
}

function drawPlaceholder(ctx: CanvasRenderingContext2D, W: number, H: number) {
  const g = ctx.createLinearGradient(0, 0, W, 0);
  g.addColorStop(0, "#37485a");
  g.addColorStop(0.42, "#6a6f70");
  g.addColorStop(0.72, "#c7a884");
  g.addColorStop(1, "#ecd6b6");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

function drawOverlay(ctx: CanvasRenderingContext2D, ov: Overlay, W: number, H: number) {
  const c = ov.color;
  const o = ov.opacity;
  const hold = Math.max(0, Math.min(100, ov.hold ?? 0)) / 100;
  const cov = ov.coverage || "full";
  let g: CanvasGradient | null = null;
  if (cov === "left") g = ctx.createLinearGradient(0, 0, W, 0);
  else if (cov === "right") g = ctx.createLinearGradient(W, 0, 0, 0);
  else if (cov === "top") g = ctx.createLinearGradient(0, 0, 0, H);
  else if (cov === "bottom") g = ctx.createLinearGradient(0, H, 0, 0);
  if (ov.gradient && g) {
    g.addColorStop(0, hexA(c, o));
    g.addColorStop(hold, hexA(c, o));
    g.addColorStop(1, hexA(c, 0));
    ctx.fillStyle = g;
  } else {
    ctx.fillStyle = hexA(c, o);
  }
  ctx.fillRect(0, 0, W, H);
}

function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const words = String(text).split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const t = line ? line + " " + w : w;
    if (ctx.measureText(t).width > maxW && line) {
      lines.push(line);
      line = w;
    } else line = t;
  }
  if (line) lines.push(line);
  return lines;
}

/** Render a banner to a fresh canvas at the template's exact pixel size. */
export function renderBanner(input: RenderInput): HTMLCanvasElement {
  const { template, size, image, texts, showText } = input;
  const dim = template.sizes[size];
  const canvas = document.createElement("canvas");
  canvas.width = dim.w;
  canvas.height = dim.h;
  const ctx = canvas.getContext("2d")!;

  // background
  if (image) {
    const pos = size === "mobile" ? template.background.positionMobile : template.background.position;
    drawCover(ctx, image, dim.w, dim.h, pos);
  } else if (template.background.color) {
    ctx.fillStyle = template.background.color;
    ctx.fillRect(0, 0, dim.w, dim.h);
  } else {
    drawPlaceholder(ctx, dim.w, dim.h);
  }

  // overlay (per size)
  const ov = size === "mobile" && template.overlayMobile ? template.overlayMobile : template.overlay;
  if (ov) drawOverlay(ctx, ov, dim.w, dim.h);

  // text
  if (showText) {
    for (const raw of template.elements) {
      if (size === "mobile" && raw.hiddenMobile) continue;
      const el = resolveElement(raw, size);
      const text = texts[raw.key] ?? el.default;
      const [v, h] =
        el.anchor === "center" ? ["center", "center"] : (el.anchor || "top-left").split("-");
      ctx.font = `${el.weight || 400} ${el.size}px "${template.defaultFont}", sans-serif`;
      ctx.fillStyle = el.color;
      ctx.textAlign = h as CanvasTextAlign;
      if ("letterSpacing" in ctx) (ctx as any).letterSpacing = (el.letterSpacing || 0) + "px";
      const displayText = el.uppercase ? text.toUpperCase() : text;
      const maxW = ((el.maxWidthPct ?? 90) / 100) * dim.w;
      const lh = (el.lineHeight || 1.15) * el.size;
      const lines = wrapLines(ctx, displayText, maxW);
      const totalH = lines.length * lh;
      const bx = (el.x / 100) * dim.w;
      const by = (el.y / 100) * dim.h;
      let firstBase: number;
      if (v === "top") firstBase = by + el.size;
      else if (v === "bottom") firstBase = by - totalH + el.size;
      else firstBase = by - totalH / 2 + el.size;
      lines.forEach((ln, i) => ctx.fillText(ln, bx, firstBase + i * lh));
      if ("letterSpacing" in ctx) (ctx as any).letterSpacing = "0px";
    }
  }

  return canvas;
}
