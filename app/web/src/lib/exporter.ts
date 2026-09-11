import * as htmlToImage from "html-to-image";

export type ExportFormat = "png" | "jpeg" | "webp";

export type ExportOptions = {
  format: ExportFormat;
  /** Target file size in KB. If set (and format is jpeg/webp), quality is tuned to hit it. */
  targetKB?: number;
  /** Background for formats without transparency (jpeg). */
  background?: string;
};

const MIME: Record<ExportFormat, string> = {
  png: "image/png",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality?: number
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Could not encode image."))),
      type,
      quality
    );
  });
}

/**
 * Render a DOM node to a canvas at its exact pixel size.
 * The node itself is sized in real pixels; a CSS transform on an ancestor
 * only scales the on-screen preview and does not affect the output size.
 */
async function nodeToCanvas(
  node: HTMLElement,
  width: number,
  height: number,
  background?: string
): Promise<HTMLCanvasElement> {
  return htmlToImage.toCanvas(node, {
    width,
    height,
    pixelRatio: 1,
    cacheBust: true,
    backgroundColor: background,
    // The preview may be visually scaled; force the clone to full size.
    style: { transform: "none", transformOrigin: "top left", margin: "0" },
  });
}

/** Encode a canvas, tuning quality to meet a target KB when requested. */
async function encode(
  canvas: HTMLCanvasElement,
  opts: ExportOptions
): Promise<Blob> {
  const type = MIME[opts.format];

  if (opts.format === "png" || !opts.targetKB) {
    const quality = opts.format === "png" ? undefined : 0.92;
    return canvasToBlob(canvas, type, quality);
  }

  // Binary-search the quality that lands just under the target size.
  const targetBytes = opts.targetKB * 1024;
  let lo = 0.3;
  let hi = 0.95;
  let best = await canvasToBlob(canvas, type, hi);
  if (best.size <= targetBytes) return best; // already small enough at high quality

  for (let i = 0; i < 8; i++) {
    const mid = (lo + hi) / 2;
    const blob = await canvasToBlob(canvas, type, mid);
    if (blob.size <= targetBytes) {
      best = blob; // acceptable — try to push quality back up
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return best;
}

/** Load an image data URL onto a canvas at its natural size. */
function dataUrlToCanvas(dataUrl: string): Promise<HTMLCanvasElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) return reject(new Error("Canvas not supported."));
      ctx.drawImage(img, 0, 0);
      resolve(canvas);
    };
    img.onerror = () => reject(new Error("Could not load image."));
    img.src = dataUrl;
  });
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export type ExportResult = { filename: string; bytes: number };

/** Render, encode and download a banner node. Returns the final size. */
export async function exportBanner(
  node: HTMLElement,
  width: number,
  height: number,
  filenameBase: string,
  opts: ExportOptions
): Promise<ExportResult> {
  const bg = opts.format === "jpeg" ? opts.background || "#ffffff" : opts.background;
  const canvas = await nodeToCanvas(node, width, height, bg);
  const blob = await encode(canvas, opts);
  const ext = opts.format === "jpeg" ? "jpg" : opts.format;
  const filename = `${filenameBase}.${ext}`;
  triggerDownload(blob, filename);
  return { filename, bytes: blob.size };
}

/** Convert + download an already-generated image (used by the ad-image mode). */
export async function exportImageDataUrl(
  dataUrl: string,
  filenameBase: string,
  opts: ExportOptions
): Promise<ExportResult> {
  const canvas = await dataUrlToCanvas(dataUrl);
  if (opts.format === "jpeg") {
    // Flatten transparency onto a background for JPG.
    const flat = document.createElement("canvas");
    flat.width = canvas.width;
    flat.height = canvas.height;
    const ctx = flat.getContext("2d")!;
    ctx.fillStyle = opts.background || "#ffffff";
    ctx.fillRect(0, 0, flat.width, flat.height);
    ctx.drawImage(canvas, 0, 0);
    const blob = await encode(flat, opts);
    const filename = `${filenameBase}.jpg`;
    triggerDownload(blob, filename);
    return { filename, bytes: blob.size };
  }
  const blob = await encode(canvas, opts);
  const ext = opts.format === "webp" ? "webp" : "png";
  const filename = `${filenameBase}.${ext}`;
  triggerDownload(blob, filename);
  return { filename, bytes: blob.size };
}
